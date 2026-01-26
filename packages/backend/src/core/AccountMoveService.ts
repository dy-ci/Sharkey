/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { IsNull, In, MoreThan, Not } from 'typeorm';

import { bindThis } from '@/decorators.js';
import { DI } from '@/di-symbols.js';
import type { MiLocalUser, MiRemoteUser, MiUser } from '@/models/User.js';
import { isLocalUser, isRemoteUser } from '@/models/User.js';
import type { BlockingsRepository, FollowingsRepository, InstancesRepository, MiMeta, MutingsRepository, UserListMembershipsRepository, UsersRepository, NoteScheduleRepository, MiNoteSchedule } from '@/models/_.js';
import type { RelationshipJobData, ThinUser } from '@/queue/types.js';

import { IdService } from '@/core/IdService.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { QueueService } from '@/core/QueueService.js';
import { RelayService } from '@/core/RelayService.js';
import { ApPersonService } from '@/core/activitypub/models/ApPersonService.js';
import { ApDeliverManagerService } from '@/core/activitypub/ApDeliverManagerService.js';
import { ApRendererService } from '@/core/activitypub/ApRendererService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { FederatedInstanceService } from '@/core/FederatedInstanceService.js';
import InstanceChart from '@/core/chart/charts/instance.js';
import PerUserFollowingChart from '@/core/chart/charts/per-user-following.js';
import { SystemAccountService } from '@/core/SystemAccountService.js';
import { RoleService } from '@/core/RoleService.js';
import { AntennaService } from '@/core/AntennaService.js';
import { CacheService } from '@/core/CacheService.js';
import { UserListService } from '@/core/UserListService.js';
import { TimeService } from '@/global/TimeService.js';
import { InternalEventService } from '@/global/InternalEventService.js';
import { CollapsedQueueService } from '@/core/CollapsedQueueService.js';
import { LoggerService } from '@/core/LoggerService.js';
import { EnvService } from '@/global/EnvService.js';
import type Logger from '@/logger.js';
import { renderInlineError } from '@/misc/render-inline-error.js';
import { IdentifiableError } from '@/misc/identifiable-error.js';
import type { Packed } from '@/misc/json-schema.js';
import type { Config } from '@/config.js';
import { ApResolverService, type Resolver } from '@/core/activitypub/ApResolverService.js';
import { UtilityService } from '@/core/UtilityService.js';
import { UserFollowingService } from '@/core/UserFollowingService.js';
import { UserBlockingService } from '@/core/UserBlockingService.js';

export interface MigrationOpts {
	/**
	 * If true, notifications are suppressed for the migration.
	 * If false, normal notifications are produced.
	 * If null (default), notification are produced unless this is a repeat (forced) migration.
	 */
	silent?: boolean | null;

	/**
	 * If true, miration will run even if already complete.
	 * If false (default), migration will be skipped if it's completed successfully.
	 */
	allowRepeat?: boolean;

	/**
	 * If true, allow inactive (suspended, deleted, defederated, etc) users to migrate.
	 * If false (default), migration is skipped for inactive users.
	 */
	allowInactive?: boolean;

	/**
	 * If true, await all migration sub-steps and return only after the entire process is done.
	 * If false (default), additional background jobs are created to asynchronously complete sub-steps.
	 */
	immediate?: boolean;
}

@Injectable()
export class AccountMoveService {
	private readonly logger: Logger;

	constructor(
		@Inject(DI.meta)
		private meta: MiMeta,

		@Inject(DI.config)
		private readonly config: Config,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.followingsRepository)
		private followingsRepository: FollowingsRepository,

		@Inject(DI.blockingsRepository)
		private blockingsRepository: BlockingsRepository,

		@Inject(DI.mutingsRepository)
		private mutingsRepository: MutingsRepository,

		@Inject(DI.userListMembershipsRepository)
		private userListMembershipsRepository: UserListMembershipsRepository,

		@Inject(DI.instancesRepository)
		private instancesRepository: InstancesRepository,

		@Inject(DI.noteScheduleRepository)
		private noteScheduleRepository: NoteScheduleRepository,

		private userEntityService: UserEntityService,
		private idService: IdService,
		private apPersonService: ApPersonService,
		private apRendererService: ApRendererService,
		private apDeliverManagerService: ApDeliverManagerService,
		private globalEventService: GlobalEventService,
		private perUserFollowingChart: PerUserFollowingChart,
		private federatedInstanceService: FederatedInstanceService,
		private instanceChart: InstanceChart,
		private relayService: RelayService,
		private queueService: QueueService,
		private systemAccountService: SystemAccountService,
		private roleService: RoleService,
		private antennaService: AntennaService,
		private readonly cacheService: CacheService,
		private readonly userListService: UserListService,
		private readonly timeService: TimeService,
		private readonly internalEventService: InternalEventService,
		private readonly loggerService: LoggerService,
		private readonly envService: EnvService,
		private readonly collapsedQueueService: CollapsedQueueService,
		private readonly apResolverService: ApResolverService,
		private readonly utilityService: UtilityService,
		private readonly userFollowingService: UserFollowingService,
		private readonly userBlockingService: UserBlockingService,
	) {
		this.logger = this.loggerService.getLogger('account-move');
	}

	@bindThis
	public async restartMigration(src: MiUser): Promise<void> {
		if (!src.movedToUri) {
			throw new IdentifiableError('ddcf173a-00f2-4aa4-ba12-cddd131bacf4', `Can't restart migrated for user ${src.id}: user has not migrated`);
		}

		// Queue it up, since this is a slow process
		this.logger.info(`Restarting migration from ${src.id} (@${src.usernameLower}@${src.host ?? this.config.host}) to ${src.movedToUri}`);
		await this.queueService.createCheckUserMigrationJob(src.id, { allowRepeat: true });
	}

	/**
	 * Move a local account to a new account.
	 *
	 * After delivering Move activity, its local followers unfollow the old account and then follow the new one.
	 */
	@bindThis
	public async moveFromLocal(src: MiLocalUser, dst: MiUser, opts?: MigrationOpts): Promise<Packed<'MeDetailed'>> {
		// Compute this first, before we clobber src.
		const isRepeatMigration = src.movedAt != null;
		const silent = opts?.silent ?? isRepeatMigration;

		const srcUri = this.userEntityService.getUserUri(src);
		const dstUri = this.userEntityService.getUserUri(dst);

		// add movedToUri to indicate that the user has moved
		const update = {} as Partial<MiLocalUser>;
		update.alsoKnownAs = src.alsoKnownAs?.includes(dstUri) ? src.alsoKnownAs : src.alsoKnownAs?.concat([dstUri]) ?? [dstUri];
		update.movedToUri = dstUri;
		update.movedAt = this.timeService.date;
		await this.usersRepository.update(src.id, update);
		Object.assign(src, update);

		// Update cache
		await this.internalEventService.emit('localUserUpdated', { id: src.id });

		const srcPerson = await this.apRendererService.renderPerson(src);
		const updateAct = this.apRendererService.addContext(this.apRendererService.renderUpdate(srcPerson, src));
		await this.apDeliverManagerService.deliverToFollowers(src, updateAct);
		await this.relayService.deliverToRelays(src, updateAct);

		// Deliver Move activity to the followers of the old account
		const moveAct = this.apRendererService.addContext(this.apRendererService.renderMove(src, dst));
		await this.apDeliverManagerService.deliverToFollowers(src, moveAct);
		await this.relayService.deliverToRelays(src, moveAct);

		// Publish meUpdated event
		const iObj = await this.userEntityService.pack(src.id, src, { schema: 'MeDetailed', includeSecrets: true });
		if (!silent) await this.globalEventService.publishMainStream(src.id, 'meUpdated', iObj);

		// Unfollow after 24 hours
		const followings = await this.followingsRepository.findBy({
			followerId: src.id,
		});
		await this.queueService.createDelayedUnfollowJob(followings.map(following => ({
			from: { id: src.id },
			to: { id: following.followeeId },
			silent,
		})), this.envService.env.NODE_ENV === 'test' ? 10000 : 1000 * 60 * 60 * 24);

		if (opts?.immediate) {
			await this.postMoveProcess(src, dst, { ...opts, silent });
		} else {
			await this.queueService.createMoveJob(src, dst, silent);
		}

		return iObj;
	}

	@bindThis
	public async postMoveProcess(src: MiUser, dst: MiUser, opts?: MigrationOpts): Promise<void> {
		const immediate = opts?.immediate ?? false;
		const silent = opts?.silent ?? false;

		// Copy blockings and mutings, and update lists
		await this.copyBlocking(src, dst, immediate, silent)
			.catch(err => this.logger.warn(`Error copying blockings in migration ${src.id} (@${src.usernameLower}@${src.host ?? this.config.host}) to ${dst.id} (@${dst.usernameLower}@${dst.host ?? this.config.host}): ${renderInlineError(err)}`));
		await this.copyMutings(src, dst)
			.catch(err => this.logger.warn(`Error copying mutings in migration ${src.id} (@${src.usernameLower}@${src.host ?? this.config.host}) to ${dst.id} (@${dst.usernameLower}@${dst.host ?? this.config.host}): ${renderInlineError(err)}`));
		await this.deleteScheduledNotes(src)
			.catch(err => this.logger.warn(`Error deleting scheduled notes in migration ${src.id} (@${src.usernameLower}@${src.host ?? this.config.host}) to ${dst.id} (@${dst.usernameLower}@${dst.host ?? this.config.host}): ${renderInlineError(err)}`));
		await this.copyRoles(src, dst, silent)
			.catch(err => this.logger.warn(`Error copying roles in migration ${src.id} (@${src.usernameLower}@${src.host ?? this.config.host}) to ${dst.id} (@${dst.usernameLower}@${dst.host ?? this.config.host}): ${renderInlineError(err)}`));
		await this.updateLists(src, dst)
			.catch(err => this.logger.warn(`Error updating lists in migration ${src.id} (@${src.usernameLower}@${src.host ?? this.config.host}) to ${dst.id} (@${dst.usernameLower}@${dst.host ?? this.config.host}): ${renderInlineError(err)}`));
		await this.antennaService.onMoveAccount(src, dst)
			.catch(err => this.logger.warn(`Error updating antennas in migration ${src.id} (@${src.usernameLower}@${src.host ?? this.config.host}) to ${dst.id} (@${dst.usernameLower}@${dst.host ?? this.config.host}): ${renderInlineError(err)}`));
		await this.copyFollows(src, dst, immediate, silent)
			.catch(err => this.logger.warn(`Error copying follows in migration ${src.id} (@${src.usernameLower}@${src.host ?? this.config.host}) to ${dst.id} (@${dst.usernameLower}@${dst.host ?? this.config.host}): ${renderInlineError(err)}`));
	}

	@bindThis
	private async copyFollows(src: MiUser, dst: MiUser, immediate: boolean, silent: boolean): Promise<void> {
		// follow the new account
		const proxy = await this.systemAccountService.fetch('proxy');
		const followings = await this.followingsRepository.findBy({
			followeeId: src.id,
			followerHost: IsNull(), // follower is local
			followerId: Not(proxy.id),
		});
		const followJobs = followings.map(following => ({
			from: { id: following.followerId },
			to: { id: dst.id },
			withReplies: following.withReplies,
			silent,
		})) as RelationshipJobData[];

		// Decrease following count instead of unfollowing.
		try {
			await this.adjustFollowingCounts(followJobs.map(job => job.from.id), src);
		} catch (err) {
			/* skip if any error happens */
			this.logger.warn(`Non-fatal exception in migration from ${src.id} (@${src.usernameLower}@${src.host ?? this.config.host}) to ${dst.id} (@${dst.usernameLower}@${dst.host ?? this.config.host}): ${renderInlineError(err)}`);
		}

		if (immediate) {
			for (const { from, to, withReplies, silent } of followJobs) {
				await this.userFollowingService.follow(from, to, { withReplies, silent });
			}
		} else {
			// Should be queued because this can cause a number of follow per one move.
			await this.queueService.createFollowJob(followJobs);
		}
	}

	@bindThis
	private async copyBlocking(src: ThinUser, dst: ThinUser, immediate: boolean, silent: boolean): Promise<void> {
		// Followers shouldn't overlap with blockers, but the destination account, different from the blockee (i.e., old account), may have followed the local user before moving.
		// So block the destination account here.
		const [srcBlockers, dstBlockers, dstFollowers] = await Promise.all([
			this.blockingsRepository.find({ where: { blockeeId: src.id }, select: { blockerId: true } }).then(bs => new Set(bs.map(f => f.blockerId))),
			this.blockingsRepository.find({ where: { blockeeId: dst.id }, select: { blockerId: true } }).then(bs => new Set(bs.map(f => f.blockerId))),
			this.followingsRepository.find({ where: { followeeId: dst.id }, select: { followerId: true } }).then(fs => new Set(fs.map(f => f.followerId))),
		]);
		// reblock the destination account
		const blockJobs: RelationshipJobData[] = [];
		for (const blockerId of srcBlockers) {
			if (dstBlockers.has(blockerId)) continue; // skip if already blocked
			if (dstFollowers.has(blockerId)) continue; // skip if already following
			blockJobs.push({ from: { id: blockerId }, to: { id: dst.id }, silent });
		}

		if (immediate) {
			for (const { from, to, silent } of blockJobs) {
				await this.userBlockingService.block(from.id, to.id, silent);
			}
		} else {
			// no need to unblock the old account because it may be still functional
			await this.queueService.createBlockJob(blockJobs);
		}
	}

	@bindThis
	private async copyMutings(src: ThinUser, dst: ThinUser): Promise<void> {
		// Insert new mutings with the same values except mutee
		const oldMutings = await this.mutingsRepository.findBy([
			{ muteeId: src.id, expiresAt: IsNull() },
			{ muteeId: src.id, expiresAt: MoreThan(this.timeService.date) },
		]);
		if (oldMutings.length === 0) return;

		// Check if the destination account is already indefinitely muted by the muter
		const [existingMutingsMuterUserIds, dstFollowers] = await Promise.all([
			this.mutingsRepository.findBy(
				{ muteeId: dst.id, expiresAt: IsNull() },
			).then(mutings => mutings.map(muting => muting.muterId)),
			this.followingsRepository.find({ where: { followeeId: dst.id }, select: { followerId: true } })
				.then(fs => new Set(fs.map(f => f.followerId))),
		]);

		const newMutings: Map<string, { muterId: string; muteeId: string; expiresAt: Date | null; }> = new Map();

		// 重複しないようにIDを生成
		const genId = (): string => {
			let id: string;
			do {
				id = this.idService.gen();
			} while (newMutings.has(id));
			return id;
		};
		for (const muting of oldMutings) {
			if (existingMutingsMuterUserIds.includes(muting.muterId)) continue; // skip if already muted indefinitely
			if (dstFollowers.has(muting.muterId)) continue; // skip if already following
			newMutings.set(genId(), {
				...muting,
				muteeId: dst.id,
			});
		}

		const arrayToInsert = Array.from(newMutings.entries()).map(entry => ({ ...entry[1], id: entry[0] }));
		await this.mutingsRepository.insert(arrayToInsert);
		// TODO cache sync
	}

	@bindThis
	private async deleteScheduledNotes(src: ThinUser): Promise<void> {
		const scheduledNotes = await this.noteScheduleRepository.findBy({
			userId: src.id,
		}) as MiNoteSchedule[];

		for (const note of scheduledNotes) {
			await this.queueService.ScheduleNotePostQueue.remove(`schedNote:${note.id}`);
		}

		await this.noteScheduleRepository.delete({
			userId: src.id,
		});
	}

	@bindThis
	private async copyRoles(src: ThinUser, dst: ThinUser, silent: boolean): Promise<void> {
		// Insert new roles with the same values except userId
		// role service may have cache for roles so retrieve roles from service
		const [oldRoleAssignments, roles] = await Promise.all([
			this.roleService.getUserAssigns(src.id),
			this.roleService.getRoles(),
		]);

		if (oldRoleAssignments.length === 0) return;

		// No promise all since the only async operation is writing to the database
		for (const oldRoleAssignment of oldRoleAssignments) {
			const role = roles.find(x => x.id === oldRoleAssignment.roleId);
			if (role == null) continue; // Very unlikely however removing role may cause this case
			if (!role.preserveAssignmentOnMoveAccount) continue;

			try {
				await this.roleService.assign(dst.id, role.id, oldRoleAssignment.expiresAt, undefined, silent);
			} catch (e) {
				if (e instanceof RoleService.AlreadyAssignedError) continue;
				throw e;
			}
		}
	}

	/**
	 * Update lists while moving accounts.
	 *   - No removal of the old account from the lists
	 *   - Users number limit is not checked
	 *
	 * @param src ThinUser (old account)
	 * @param dst User (new account)
	 * @returns Promise<void>
	 */
	@bindThis
	private async updateLists(src: ThinUser, dst: MiUser): Promise<void> {
		// Return if there is no list to be updated.
		const [srcMemberships, dstMemberships] = await Promise.all([
			this.cacheService.userListMembershipsCache.fetch(src.id),
			this.cacheService.userListMembershipsCache.fetch(dst.id),
		]);
		if (srcMemberships.size === 0) return;

		const newMemberships = srcMemberships.values()
			.filter(srcMembership => !dstMemberships.has(srcMembership.userListId))
			.map(srcMembership => ({
				userListId: srcMembership.userListId,
				withReplies: srcMembership.withReplies,
			}))
			.toArray();
		const updatedMemberships = srcMemberships.values()
			.filter(srcMembership => {
				const dstMembership = dstMemberships.get(srcMembership.userListId);
				return dstMembership != null && dstMembership.withReplies !== srcMembership.withReplies;
			})
			.map(srcMembership => ({
				userListId: srcMembership.userListId,
				withReplies: srcMembership.withReplies,
			}))
			.toArray();

		if (newMemberships.length > 0) {
			await this.userListService.bulkAddMember(dst, newMemberships);
		}
		if (updatedMemberships.length > 0) {
			await this.userListService.bulkUpdateMembership(dst, updatedMemberships);
		}
	}

	@bindThis
	private async adjustFollowingCounts(localFollowerIds: string[], oldAccount: MiUser): Promise<void> {
		if (localFollowerIds.length === 0) return;

		// Set the old account's following and followers counts to 0.
		await this.collapsedQueueService.updateUserQueue.performNow(oldAccount.id);
		await this.usersRepository.update({ id: oldAccount.id }, { followersCount: 0, followingCount: 0 });
		await this.internalEventService.emit('userUpdated', { id: oldAccount.id });

		// Decrease following counts of local followers by 1.
		for (const followerId of localFollowerIds) {
			this.collapsedQueueService.updateUserQueue.enqueue(followerId, { followingCountDelta: -1 });
		}

		// Decrease follower counts of local followees by 1.
		const oldFollowings = await this.followingsRepository.find({ where: { followerId: oldAccount.id }, select: { followeeId: true } });
		const oldFolloweeIds = oldFollowings.map(f => f.followeeId);
		for (const followeeId of oldFolloweeIds) {
			this.collapsedQueueService.updateUserQueue.enqueue(followeeId, { followersCountDelta: -1 });
		}

		// Update instance stats by decreasing remote followers count by the number of local followers who were following the old account.
		if (this.meta.enableStatsForFederatedInstances) {
			if (this.userEntityService.isRemoteUser(oldAccount)) {
				{
					this.collapsedQueueService.updateInstanceQueue.enqueue(oldAccount.host, { followersCountDelta: 0 - localFollowerIds.length });
					if (this.meta.enableChartsForFederatedInstances) {
						this.instanceChart.updateFollowers(oldAccount.host, false);
					}
				}
			}
		}

		// FIXME: expensive?
		for (const followerId of localFollowerIds) {
			this.perUserFollowingChart.update({ id: followerId, host: null }, oldAccount, false);
		}
	}

	/**
	 * TODO this is fucked, remove it ASAP
	 * dstユーザーのalsoKnownAsをfetchPersonしていき、本当にmovedToUrlをdstに指定するユーザーが存在するのかを調べる
	 *
	 * @param dst movedToUrlを指定するユーザー
	 * @param check
	 * @param instant checkがtrueであるユーザーが最初に見つかったら即座にreturnするかどうか
	 * @returns Promise<LocalUser | RemoteUser | null>
	 */
	@bindThis
	public async validateAlsoKnownAs(
		dst: MiLocalUser | MiRemoteUser | MiUser,
		check: (oldUser: MiLocalUser | MiRemoteUser | null, newUser: MiLocalUser | MiRemoteUser) => boolean | Promise<boolean> = () => true,
		instant = false,
	): Promise<MiLocalUser | MiRemoteUser | null> {
		let resultUser: MiLocalUser | MiRemoteUser | null = null;

		if (this.userEntityService.isRemoteUser(dst)) {
			if (this.timeService.now - (dst.lastFetchedAt?.getTime() ?? 0) > 10 * 1000) {
				await this.apPersonService.updatePerson(dst.uri);
			}
			dst = await this.apPersonService.fetchPerson(dst.uri) ?? dst;
		}

		if (!dst.alsoKnownAs || dst.alsoKnownAs.length === 0) return null;

		const dstUri = this.userEntityService.getUserUri(dst);

		for (const srcUri of dst.alsoKnownAs) {
			try {
				let src = await this.apPersonService.fetchPerson(srcUri);
				if (!src) continue; // oldAccountを探してもこのサーバーに存在しない場合はフォロー関係もないということなのでスルー

				if (this.userEntityService.isRemoteUser(dst)) {
					if (this.timeService.now - (src.lastFetchedAt?.getTime() ?? 0) > 10 * 1000) {
						await this.apPersonService.updatePerson(srcUri);
					}

					src = await this.apPersonService.fetchPerson(srcUri) ?? src;
				}

				if (src.movedToUri === dstUri) {
					if (await check(resultUser, src)) {
						resultUser = src;
					}
					if (instant && resultUser) return resultUser;
				}
			} catch {
				/* skip if any error happens */
			}
		}

		return resultUser;
	}

	/**
	 * Checks the migration chain for this user, and completes any pending migrations to/from them.
	 * The "immediate" option is recommended, otherwise multiple runs may be required to complete a full migration chain.
	 * @param uri URI of the user to check
	 * @param opts standard migration options, plus an optional Resolver instance.
	 */
	@bindThis
	public async checkUserMigration(uri: string, opts?: MigrationOpts & { resolver?: Resolver }): Promise<void> {
		// Shared resolver prevents infinite migration chains
		const resolver = opts?.resolver ?? this.apResolverService.createResolver();

		// Make sure user is updated and able to migrate
		const user = await this.fetchMigrationUser(uri, resolver, opts);
		if (!user) return;

		// Tracking list prevents recursive migration.
		// Migration to an account is not allowed if the URI already exists in this list.
		const movePreventUris = new Set<string>();

		// Check move tree up to user.
		// This must be first in case the user has an existing chain of prior migrations.
		if (user.alsoKnownAs) {
			for (const movedFromUri of user.alsoKnownAs) {
				await this.checkUserMigrationBack(movedFromUri, user, resolver, movePreventUris, opts);
			}
		}

		// back/forward implementations leave a "gap" in movePreventUris, so cover it during the phase transition.
		movePreventUris.add(uri);

		// Check move tree from user forward
		if (user.movedToUri) {
			await this.checkUserMigrationForward(user, user.movedToUri, resolver, movePreventUris, opts);
		}
	}

	/**
	 * Processes "backwards" migration - crawling from updated "to" to unknown "fromUri".
	 * "to" should be up-to-date and active.
	 */
	private async checkUserMigrationBack(fromUri: string, to: MiUser, resolver: Resolver, movePreventUris: Set<string>, opts: MigrationOpts | undefined): Promise<void> {
		// Fetch "from" user
		const from = await this.fetchMigrationUser(fromUri, resolver, opts);
		if (!from) return;

		// Check (?)->from
		if (from.alsoKnownAs) {
			for (const uri of from.alsoKnownAs) {
				await this.checkUserMigrationBack(uri, from, resolver, movePreventUris, opts);
			}
		}

		// Lock from URI only after all ancestors are checked
		movePreventUris.add(fromUri);

		// Check from->to
		await this.checkAndMigrate(from, to, movePreventUris, opts);
	}

	/**
	 * Processes "forward" migration - crawling from updated "from" to unknown "toUri".
	 * "from" should be up-to-date and active.
	 */
	@bindThis
	private async checkUserMigrationForward(from: MiUser, toUri: string, resolver: Resolver, movePreventUris: Set<string>, opts: MigrationOpts | undefined): Promise<void> {
		// Fetch "to" user
		const to = await this.fetchMigrationUser(toUri, resolver, opts);
		if (!to) return;

		// Check from->to
		await this.checkAndMigrate(from, to, movePreventUris, opts);

		// Lock to URI only after destination is checked
		movePreventUris.add(toUri);

		// Check to->(?)
		if (to.movedToUri) {
			await this.checkUserMigrationForward(to, to.movedToUri, resolver, movePreventUris, opts);
		}
	}

	/**
	 * Checks if a migration is pending from "from" to "to" - and if so, processes it.
	 * "from" and "to" should already be validated - this does not check activity, duplicate migrations, etc.
	 * The caller is responsible for updating movePreventUris!!
	 * @param from Account being moved from
	 * @param to Account being moved into
	 * @param movePreventUris URIs of all accounts that have directly or indirectly migrated to "from".
	 * @param opts Migration options to pass to the underlying implementation
	 */
	@bindThis
	private async checkAndMigrate(from: MiUser, to: MiUser, movePreventUris: Set<string>, opts: MigrationOpts | undefined): Promise<void> {
		const fromUri = this.userEntityService.getUserUri(from);
		const toUri = this.userEntityService.getUserUri(to);

		// Skip if source does not recognize target
		if (from.movedToUri !== toUri) {
			return;
		}

		// Skip if target does not recognize source
		if (!to.alsoKnownAs?.some(uri => uri === fromUri)) {
			return;
		}

		// Skip if target already exists in the migration chain
		if (movePreventUris.has(toUri)) {
			return;
		}

		// Skip if source and target are the same
		if (fromUri === toUri) {
			return;
		}

		// Success - migrate it!
		await this.migrateUser(from, to, opts);
	}

	@bindThis
	private async migrateUser(from: MiUser, to: MiUser, opts: MigrationOpts | undefined): Promise<void> {
		const movedAt = this.timeService.date;

		// Mark the user as migrated *first* to prevent races with other migration chains
		if (!await this.lockUserForMigration(from, movedAt)) {
			this.logger.debug(`Skipping from ${from.id} (${from.uri}) to ${to.id} (${to.uri}): detection race with another task`);
			return;
		}

		// Do the migration!
		try {
			if (isLocalUser(from)) {
				await this.moveFromLocal(from, to, opts);
			} else {
				await this.postMoveProcess(from, to, opts);
			}
		} catch (err) {
			this.logger.error(`Error migrating user from ${from.id} (${from.uri}) to ${to.id} (${to.uri}): ${renderInlineError(err)}`);

			// Unlock so we can try again later
			await this.rollbackUserMigrationLock(from, movedAt);
		}
	}

	@bindThis
	private async lockUserForMigration(user: MiUser, movedAt: Date): Promise<boolean> {
		const result = await this.usersRepository.update({ id: user.id, movedAt: IsNull() }, { movedAt });
		if (!result.affected) return false;

		await this.internalEventService.emit('userUpdated', { id: user.id });
		return true;
	}

	@bindThis
	private async rollbackUserMigrationLock(user: MiUser, movedAt: Date): Promise<boolean> {
		const result = await this.usersRepository.update({ id: user.id, movedAt }, { movedAt: null });
		if (!result.affected) return false;

		await this.internalEventService.emit('userUpdated', { id: user.id });
		return true;
	}

	@bindThis
	private async fetchMigrationUser(uri: string | null, resolver: Resolver, opts: MigrationOpts | undefined): Promise<MiUser | null> {
		if (!uri) return null;

		let user: MiUser | null = await this.apPersonService.fetchPerson(uri);
		if (!user) {
			// Resolve missing users
			user = await this.apPersonService.resolvePerson(uri, resolver).catch(() => null);
		} else if (isRemoteUser(user)) {
			// Make sure cached remote users are updated
			user = await this.apPersonService.ensureUpdated(user, { resolver, ignoreErrors: true, timeout: 1000 * 60 * 60 });
		}

		// Skip if not found
		if (!user) return null;

		// Skip if inactive
		if (!this.utilityService.isActiveUser(user) && !opts?.allowInactive) return null;

		// Skip if already moved (unless force-migrating)
		if (user.movedAt && !opts?.allowRepeat) return null;

		return user;
	}
}
