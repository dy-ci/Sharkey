# Contribution guide
We're glad you're interested in contributing to Sharkey! In this document you will find the information you need to contribute to the project.

## Roadmap
See [ROADMAP.md](./ROADMAP.md) for the upstream Misskey roadmap.

## Issues
Before creating an issue, please check the following:
- To avoid duplication, please search for similar issues before creating a new issue.
- Do not use Issues to ask questions or troubleshooting.
	- Issues should only be used to feature requests, suggestions, and bug tracking.
	- Please ask questions or troubleshooting in [Discord](https://discord.gg/6VgKmEqHNk).

> [!WARNING]
> Do not close issues that are about to be resolved. It should remain open until a commit that actually resolves it is merged.

### Recommended discussing before implementation
We welcome your proposal.

When you want to add a feature or fix a bug, *please open an issue*,
don't just start writing code. We may suggest different approaches, or
show that the "bug" is actually intended behaviour (and offer
work-arounds), or maybe we won't be able to merge your new feature
because it would make it too hard to incorporate future changes from
Misskey. Each of these examples have actually happened!

On the other hand, it's very likely that we'll tell you "go
ahead!". We try our best to incorporate improvements from our users!

Also, when you start implementation, assign yourself to the Issue (if you cannot do it yourself, ask Committer to assign you).
By expressing your intention to work on the Issue, you can prevent conflicts in the work.

To the Committers: you should not assign someone on it before the Final Decision.

### How issues are triaged

The Committers may:
* close an issue that is not reproducible on latest stable release,
* merge an issue into another issue,
* split an issue into multiple issues,
* or re-open that has been closed for some reason which is not applicable anymore.

@syuilo reserves the Final Decision rights including whether the project will implement feature and how to implement, these rights are not always exercised.

## Well-known branches
- **`stable`** branch is tracking the latest release and used for production purposes.
- **`develop`** branch is where we work for the next release.
	- When you create a PR, basically target it to this branch.

## Creating a PR
Thank you for your PR! Before creating a PR, please check the following:
- If possible, prefix the title with a keyword that identifies the type of this PR, as shown below.
	- `fix` / `refactor` / `feat` / `enhance` / `perf` / `chore` etc
	- Also, make sure that the granularity of this PR is appropriate. Please do not include more than one type of change or interest in a single PR.
- If there is an Issue which will be resolved by this PR, please include a reference to the Issue in the text.
- Please add the summary of the changes to [`CHANGELOG.md`](CHANGELOG.md). However, this is not necessary for changes that do not affect the users, such as refactoring.
- Check if there are any documents that need to be created or updated due to this change.
- If you have added a feature or fixed a bug, please add a test case if possible.
- Please make sure that tests and Lint are passed in advance.
	- You can run it with `pnpm test` and `pnpm lint`. [See more info](#testing)
- If this PR includes UI changes, please attach a screenshot in the text.

Thanks for your cooperation 🤗

### Additional things for ActivityPub payload changes
*This section is specific to misskey-dev implementation. Other fork or implementation may take different way. A significant difference is that non-"misskey-dev" extension is not described in the misskey-hub's document.*

If PR includes changes to ActivityPub payload, please reflect it in [misskey-hub's document](https://github.com/misskey-dev/misskey-hub-next/blob/master/content/ns.md) by sending PR.

The name of purporsed extension property (referred as "extended property" in later) to ActivityPub shall be prefixed by `_misskey_`. (i.e. `_misskey_quote`)

The extended property in `packages/backend/src/core/activitypub/type.ts` **must** be declared as optional because ActivityPub payloads that comes from older Misskey or other implementation may not contain it.

The extended property must be included in the context definition. Context is defined in `packages/backend/src/core/activitypub/misc/contexts.ts`.
The key shall be same as the name of extended property, and the value shall be same as "short IRI".

"Short IRI" is defined in misskey-hub's document, but usually takes form of `misskey:<name of extended property>`. (i.e. `misskey:_misskey_quote`)

One should not add property that has defined before by other implementation, or add custom variant value to "well-known" property.

## Reviewers guide
Be willing to comment on the good points and not just the things you want fixed 💯

読んでおくといいやつ
- https://blog.lacolaco.net/posts/1e2cf439b3c2/
- https://konifar-zatsu.hatenadiary.jp/entry/2024/11/05/192421

### Review perspective
- Scope
	- Are the goals of the PR clear?
	- Is the granularity of the PR appropriate?
- Security
	- Does merging this PR create a vulnerability?
- Performance
	- Will merging this PR cause unexpected performance degradation?
	- Is there a more efficient way?
- Testing
	- Does the test ensure the expected behavior?
	- Are there any omissions or gaps?
	- Does it check for anomalies?

## Security Advisory
### For reporter
Thank you for your reporting!

If you can also create a patch to fix the vulnerability, please create a PR on the private fork.

> [!note]
> There is a GitHub bug that prevents merging if a PR not following the develop branch of upstream, so please keep follow the develop branch.

### For misskey-dev member
修正PRがdevelopに追従されていないとマージできないので、マージできなかったら

> Could you merge or rebase onto upstream develop branch?

などと伝える。

## Deploy
The `/deploy` command by issue comment can be used to deploy the contents of a PR to the preview environment.
```
/deploy sha=<commit hash>
```
An actual domain will be assigned so you can test the federation.

## Merge

## Release
### Release Instructions
1. Commit version changes in the `develop` branch ([package.json](package.json))
2. Create a release PR.
	- Into `stable` from `develop` branch.
	- The title must be in the format `Release: x.y.z`.
		- `x.y.z` is the new version you are trying to release.
3. Deploy and perform a simple QA check. Also verify that the tests passed.
4. Merge it. (Do not squash commit)
5. Create a [release](https://activitypub.software/TransFem-org/Sharkey/-/releases)
	- The target branch must be `stable`
	- The tag name must be the version

> [!NOTE]
> Why this instruction is necessary:
> - To perform final QA checks
> - To distribute responsibility
> - To check direct commits to develop
> - To celebrate the release together 🎉

## Localization (l10n)
Misskey uses [Crowdin](https://crowdin.com/project/misskey) for localization management.
You can improve our translations with your Crowdin account.
Your changes in Crowdin are automatically submitted as a PR (with the title "New Crowdin translations") to the repository.
The owner [@syuilo](https://github.com/syuilo) merges the PR into the develop branch before the next release.

If your language is not listed in Crowdin, please open an issue. We will add it to Crowdin.
For newly added languages, once the translation progress per language exceeds 70%, it will be officially introduced into Misskey and made available to users.

![Crowdin](https://d322cqt584bo4o.cloudfront.net/misskey/localized.svg)

## Icon Font (Shark Font)
Sharkey has its own Icon Font called Shark Font which can be found at https://activitypub.software/TransFem-org/shark-font
Build Instructions can all be found over there in the `README`.

If you have an Icon Suggestion or want to add an Icon please open an issue/merge request over at that repo.

When Updating the Font make sure to copy **all generated files** from the `dest` folder into `packages/backend/assets/fonts/sharkey-icons`
For the CSS simply copy the file content and replace the old content in `style.css` and for the WOFF, TTF and SVG simply replace them.

## Development
### Setup
Before developing, you have to set up environment. Misskey requires Redis, PostgreSQL, and FFmpeg.

You would want to install Meilisearch to experiment related features. Technically, meilisearch is not strict requirement, but some features and tests require it.

There are a few ways to proceed.

#### Use system-wide software
You could install them in system-wide (such as from package manager).

#### Use `docker compose`
You could obtain middleware container by typing `docker compose -f $PROJECT_ROOT/compose.local-db.yml up -d`.

#### Use Devcontainer
Devcontainer also has necessary setting. This method can be done by connecting from VSCode.

Instead of running `pnpm` locally, you can use Dev Container to set up your development environment.
To use Dev Container, open the project directory on VSCode with Dev Containers installed.
**Note:** If you are using Windows, please clone the repository with WSL. Using Git for Windows will result in broken files due to the difference in how newlines are handled.

It will run the following command automatically inside the container.
``` bash
git submodule update --init
pnpm install --frozen-lockfile
cp .devcontainer/devcontainer.yml .config/default.yml
pnpm build
pnpm migrate
```

After finishing the migration, you can proceed.

### Start developing
During development, it is useful to use the
```
pnpm dev
```
command.

- Server-side source files and automatically builds them if they are modified. Automatically start the server process(es).
- Service Worker is watched by esbuild.
- Vite HMR (just the `vite` command) is available. The behavior may be different from production.
- Vite runs behind the backend (the backend will proxy Vite at /vite and /embed_vite except for websocket used for HMR).
- You can see Misskey by accessing `http://localhost:3000` (Replace `3000` with the port configured with `port` in .config/default.yml).

## Testing

You can run non-backend tests by executing following commands:
```sh
pnpm --filter frontend test
pnpm --filter misskey-js test
```

Backend tests require manual preparation of servers. See the next section for more on this.

### Backend
There are three types of test codes for the backend:
- Unit tests: [`/packages/backend/test/unit`](/packages/backend/test/unit)
- Single-server E2E tests: [`/packages/backend/test/e2e`](/packages/backend/test/e2e)
- Multiple-server E2E tests: [`/packages/backend/test-federation`](/packages/backend/test-federation)

#### Running Unit Tests or Single-server E2E Tests
1. Create a config file:
```sh
cp .config/test-example.yml .config/test.yml
```

2. Start DB and Redis servers for testing:
```sh
docker compose -f packages/backend/test/compose.yml up
```
Instead, you can prepare an empty (data can be erased) DB and edit `.config/test.yml` appropriately.

3. Run all tests:
```sh
pnpm --filter backend test     # unit tests
pnpm --filter backend test:e2e # single-server E2E tests
```
If you want to run a specific test, run as a following command:
```sh
pnpm --filter backend test -- packages/backend/test/unit/activitypub.ts
pnpm --filter backend test:e2e -- packages/backend/test/e2e/nodeinfo.ts
```

#### Running Multiple-server E2E Tests
See [`/packages/backend/test-federation/README.md`](/packages/backend/test-federation/README.md).

## Environment Variable

- `MISSKEY_CONFIG_YML`: Specify the file path of config.yml instead of default.yml (e.g. `2nd.yml`).
- `MISSKEY_WEBFINGER_USE_HTTP`: If it's set true, WebFinger requests will be http instead of https, useful for testing federation between servers in localhost. NEVER USE IN PRODUCTION.

## Continuous integration
Sharkey uses GitLab CI for executing automated tests.
Configuration files are located in [`/.gitlab-ci.yml`](.gitlab-ci.yml).

## Vue
Misskey uses Vue(v3) as its front-end framework.
- Use TypeScript.
- **When creating a new component, please use the Composition API (with [setup sugar](https://v3.vuejs.org/api/sfc-script-setup.html) and [ref sugar](https://github.com/vuejs/rfcs/discussions/369)) instead of the Options API.**
	- Some of the existing components are implemented in the Options API, but it is an old implementation. Refactors that migrate those components to the Composition API are also welcome.

## Tabler Icons
アイコンは、Production Build時に使用されていないものが削除されるようになっています。

**アイコンを動的に設定する際には、 `ti-${someVal}` のような、アイコン名のみを動的に変化させる実装を行わないでください。**
必ず `ti-xxx` のような完全なクラス名を含めるようにしてください。

## nirax
niraxは、Misskeyで使用しているオリジナルのフロントエンドルーティングシステムです。
**vue-routerから影響を多大に受けているので、まずはvue-routerについて学ぶことをお勧めします。**

### ルート定義
ルート定義は、以下の形式のオブジェクトの配列です。

```ts
{
	name?: string;
	path: string;
	component: Component;
	query?: Record<string, string>;
	loginRequired?: boolean;
	hash?: string;
	children?: RouteDef[];
}
```

> [!WARNING]
> 現状、ルートは定義された順に評価されます。
> たとえば、`/foo/:id`ルート定義の次に`/foo/bar`ルート定義がされていた場合、後者がマッチすることはありません。

### 複数のルーター
vue-routerとの最大の違いは、niraxは複数のルーターが存在することを許可している点です。
これにより、アプリ内ウィンドウでブラウザとは個別にルーティングすることなどが可能になります。

## Storybook

Misskey uses [Storybook](https://storybook.js.org/) for UI development.

### Setup & Run

#### Setup

```bash
pnpm --filter misskey-js build
```

#### Run

```bash
pnpm --filter frontend storybook-dev
```

### Usage

When you create a new component (in this example, `MyComponent.vue`), the story file (`MyComponent.stories.ts`) will be automatically generated by the `.storybook/generate.js` script.
You can override the default story by creating a impl story file (`MyComponent.stories.impl.ts`).

```ts
/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { StoryObj } from '@storybook/vue3';
import MyComponent from './MyComponent.vue';
export const Default = {
	render(args) {
		return {
			components: {
				MyComponent,
			},
			setup() {
				return {
					args,
				};
			},
			computed: {
				props() {
					return {
						...this.args,
					};
				},
			},
			template: '<MyComponent v-bind="props" />',
		};
	},
	args: {
		foo: 'bar',
	},
	parameters: {
		layout: 'centered',
	},
} satisfies StoryObj<typeof MyComponent>;
```

If you want to opt-out from the automatic generation, create a `MyComponent.stories.impl.ts` file and add the following line to the file.

```ts
import MyComponent from './MyComponent.vue';
void MyComponent;
```

You can override the component meta by creating a meta story file (`MyComponent.stories.meta.ts`).

```ts
export const argTypes = {
	scale: {
		control: {
			type: 'range',
			min: 1,
			max: 4,
		},
	},
};
```

Also, you can use msw to mock API requests in the storybook. Creating a `MyComponent.stories.msw.ts` file to define the mock handlers.

```ts
import { HttpResponse, http } from 'msw';
export const handlers = [
	http.post('/api/notes/timeline', ({ request }) => {
		return HttpResponse.json([]);
	}),
];
```

Don't forget to re-run the `.storybook/generate.js` script after adding, editing, or removing the above files.

## Nest

### Nest Service Circular dependency / Nestでサービスの循環参照でエラーが起きた場合

#### forwardRef
まずは簡単に`forwardRef`を試してみる

```typescript
export class FooService {
	constructor(
		@Inject(forwardRef(() => BarService))
		private barService: BarService
	) {
	}
}
```

#### OnModuleInit
できなければ`OnModuleInit`を使う

```typescript
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { BarService } from '@/core/BarService';

@Injectable()
export class FooService implements OnModuleInit {
	private barService: BarService // constructorから移動してくる

	constructor(
		private moduleRef: ModuleRef,
	) {
	}

	async onModuleInit() {
		this.barService = this.moduleRef.get(BarService.name);
	}

	public async niceMethod() {
		return await this.barService.incredibleMethod({ hoge: 'fuga' });
	}
}
```

##### Service Unit Test
テストで`onModuleInit`を呼び出す必要がある

```typescript
// import ...

describe('test', () => {
	let app: TestingModule;
	let fooService: FooService; // for test case
	let barService: BarService; // for test case

	beforeEach(async () => {
		app = await Test.createTestingModule({
			imports: ...,
			providers: [
				FooService,
				{ // mockする (mockは必須ではないかもしれない)
					provide: BarService,
					useFactory: () => ({
						incredibleMethod: jest.fn(),
					}),
				},
				{ // Provideにする
					provide: BarService.name,
					useExisting: BarService,
				},
			],
		})
			.useMocker(...
			.compile();

		fooService = app.get<FooService>(FooService);
		barService = app.get<BarService>(BarService) as jest.Mocked<BarService>;

		// onModuleInitを実行する
		await fooService.onModuleInit();
	});

	test('nice', () => {
		await fooService.niceMethod();

		expect(barService.incredibleMethod).toHaveBeenCalled();
		expect(barService.incredibleMethod.mock.lastCall![0])
			.toEqual({ hoge: 'fuga' });
	});
})
```

## Notes

### Misskeyのドメイン固有の概念は`Mi`をprefixする
例えばGoogleが自社サービスをMap、Earth、DriveではなくGoogle Map、Google Earth、Google Driveのように命名するのと同じ
コード上でMisskeyのドメイン固有の概念には`Mi`をprefixすることで、他のドメインの同様の概念と区別できるほか、名前の衝突を防ぐ。
ただし、文脈上Misskeyのものを指すことが明らかであり、名前の衝突の恐れがない場合は、一時的なローカル変数に限って`Mi`を省略してもよい。

### Misskey.jsの型生成
```bash
pnpm build-misskey-js-with-types
```

### How to resolve conflictions occurred at pnpm-lock.yaml?

Just execute `pnpm` to fix it.

### INSERTするときにはsaveではなくinsertを使用する
#6441

### placeholder
SQLをクエリビルダで組み立てる際、使用するプレースホルダは重複してはならない
例えば
``` ts
query.andWhere(new Brackets(qb => {
	for (const type of ps.fileType) {
		qb.orWhere(`:type = ANY(note.attachedFileTypes)`, { type: type });
	}
}));
```
と書くと、ループ中で`type`というプレースホルダが複数回使われてしまいおかしくなる
だから次のようにする必要がある
```ts
query.andWhere(new Brackets(qb => {
	for (const type of ps.fileType) {
		const i = ps.fileType.indexOf(type);
		qb.orWhere(`:type${i} = ANY(note.attachedFileTypes)`, { [`type${i}`]: type });
	}
}));
```

### Not `null` in TypeORM
```ts
const foo = await Foos.findOne({
	bar: Not(null)
});
```
のようなクエリ(`bar`が`null`ではない)は期待通りに動作しない。
次のようにします:
```ts
const foo = await Foos.findOne({
	bar: Not(IsNull())
});
```

### `null` in SQL
SQLを発行する際、パラメータが`null`になる可能性のある場合はSQL文を出し分けなければならない
例えば
``` ts
query.where('file.folderId = :folderId', { folderId: ps.folderId });
```
という処理で、`ps.folderId`が`null`だと結果的に`file.folderId = null`のようなクエリが発行されてしまい、これは正しいSQLではないので期待した結果が得られない
だから次のようにする必要がある
``` ts
if (ps.folderId) {
	query.where('file.folderId = :folderId', { folderId: ps.folderId });
} else {
	query.where('file.folderId IS NULL');
}
```

### `[]` in SQL
SQLを発行する際、`IN`のパラメータが`[]`(空の配列)になる可能性のある場合はSQL文を出し分けなければならない
例えば
``` ts
const users = await Users.find({
	id: In(userIds)
});
```
という処理で、`userIds`が`[]`だと結果的に`user.id IN ()`のようなクエリが発行されてしまい、これは正しいSQLではないので期待した結果が得られない
だから次のようにする必要がある
``` ts
const users = userIds.length > 0 ? await Users.find({
	id: In(userIds)
}) : [];
```

### 配列のインデックス in SQL
SQLでは配列のインデックスは**1始まり**。
`[a, b, c]`の `a`にアクセスしたいなら`[0]`ではなく`[1]`と書く

### null IN
nullが含まれる可能性のあるカラムにINするときは、そのままだとおかしくなるのでORなどでnullのハンドリングをしよう。

### enumの削除は気をつける
enumの列挙の内容の削除は、その値をもつレコードを全て削除しないといけない

削除が重たかったり不可能だったりする場合は、削除しないでおく

### Migration作成方法
packages/backendで:
```sh
pnpm run build
pnpm dlx typeorm migration:generate -d ormconfig.js -o migration/<migration name>
```

- 生成後、ファイルをmigration下に移してください
- 作成されたスクリプトは不必要な変更を含むため除去してください

### コネクションには`markRaw`せよ
**Vueのコンポーネントのdataオプションとして**misskey.jsのコネクションを設定するとき、必ず`markRaw`でラップしてください。インスタンスが不必要にリアクティブ化されることで、misskey.js内の処理で不具合が発生するとともに、パフォーマンス上の問題にも繋がる。なお、Composition APIを使う場合はこの限りではない(リアクティブ化はマニュアルなため)。

### JSONのimportに気を付けよう
TypeScriptでjsonをimportすると、tscでコンパイルするときにそのjsonファイルも一緒にdistディレクトリに吐き出されてしまう。この挙動により、意図せずファイルの書き換えが発生することがあるので、jsonをimportするときは書き換えられても良いものかどうか確認すること。書き換えされて欲しくない場合は、importで読み込むのではなく、`fs.readFileSync`などの関数を使って読み込むようにすればよい。

### コンポーネントのスタイル定義でmarginを持たせない
コンポーネント自身がmarginを設定するのは問題の元となることはよく知られている
marginはそのコンポーネントを使う側が設定する

## その他
### HTMLのクラス名で follow という単語は使わない
広告ブロッカーで誤ってブロックされる

### indexというファイル名を使うな
ESMではディレクトリインポートは廃止されているのと、ディレクトリインポートせずともファイル名が index だと何故か一部のライブラリ？でディレクトリインポートだと見做されてエラーになる

### Memory Caches

Sharkey offers multiple memory cache implementations, each meant for a different use case.
The following table compares the available options:

| Cache               | Type      | Consistency | Persistence | Data Source | Cardinality | Eviction | Description                                                                                                                                                                                                                                                                |
|---------------------|-----------|-------------|-------------|-------------|-------------|----------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `MemoryKVCache`     | Key-Value | None        | None        | Caller      | Single      | Lifetime | Implements a basic in-memory Key-Value store. The implementation is entirely synchronous, except for user-provided data sources.                                                                                                                                           |
| `MemorySingleCache` | Single    | None        | None        | Caller      | Single      | Lifetime | Implements a basic in-memory Single Value store. The implementation is entirely synchronous, except for user-provided data sources.                                                                                                                                        |
| `RedisKVCache`      | Key-Value | Eventual    | Redis       | Callback    | Single      | Lifetime | Extends `MemoryKVCache` with Redis-backed persistence and a pre-defined callback data source. This provides eventual consistency guarantees based on the memory cache lifetime.                                                                                            |
| `RedisSingleCache`  | Single    | Eventual    | Redis       | Callback    | Single      | Lifetime | Extends `MemorySingleCache` with Redis-backed persistence and a pre-defined callback data source. This provides eventual consistency guarantees based on the memory cache lifetime.                                                                                        |
| `QuantumKVCache`    | Key-Value | Immediate   | None        | Callback    | Multiple    | Lifetime | Combines `MemoryKVCache` with a pre-defined callback data source and immediate consistency via Redis sync events. The implementation offers multi-item batch overloads for efficient bulk operations. **This is the recommended cache implementation for most use cases.** |

Key-Value caches store multiple entries per cache, while Single caches store a single value that can be accessed directly.
Consistency refers to the consistency of cached data between different processes in the instance cluster: "None" means no consistency guarantees, "Eventual" caches will gradually become consistent after some unknown time, and "Immediate" consistency ensures accurate data ASAP after the update.
Caches with persistence can retain their data after a reboot through an external service such as Redis.
If a data source is supported, then this allows the cache to directly load missing data in response to a fetch.
"Caller" data sources are passed into the fetch method(s) directly, while "Callback" sources are passed in as a function when the cache is first initialized.
The cardinality of a cache refers to the number of items that can be updated in a single operation, and eviction, finally, is the method that the cache uses to evict stale data.

#### Selecting a cache implementation

For most cache uses, `QuantumKVCache` should be considered first.
It offers strong consistency guarantees, multiple cardinality, and a cleaner API surface than the older caches.
An alternate cache implementation should be considered if any of the following apply:
* The data is particularly slow to calculate or difficult to access. In these cases, either `RedisKVCache` or `RedisSingleCache` should be considered.
* If stale data is acceptable, then consider `MemoryKVCache` or `MemorySingleCache`. These synchronous implementations have much less overhead than the other options.
* There is only one data item, or all data items must be fetched together. Using `MemorySingleCache` or `RedisSingleCache` could provide a cleaner implementation without resorting to hacks like a fixed key.

## CSS Recipe

### Lighten CSS vars

``` css
color: hsl(from var(--MI_THEME-accent) h s calc(l + 10));
```

### Darken CSS vars

``` css
color: hsl(from var(--MI_THEME-accent) h s calc(l - 10));
```

### Add alpha to CSS vars

``` css
color: color(from var(--MI_THEME-accent) srgb r g b / 0.5);
```

## Merging from Misskey into Sharkey

Make sure you have both remotes in the same clone (`git remote add misskey
https://github.com/misskey-dev/misskey.git`), then:

	git remote update
	git checkout develop   # this is Sharkey's develop
	git checkout -m merge/$(date +%Y-%m-%d)   # or whatever
	git merge --no-ff misskey/develop

fix conflicts and *commit*! (conflicts in `pnpm-lock.yaml` can usually
be fixed by running `pnpm install`, it detects conflict markers and
seems to do a decent job)

*after that commit*, do all the extra work, on the same branch:

* copy all changes (commit after each step):
    * in `packages/backend/src/core/activitypub/models/ApNoteService.ts`, from `createNote` to `updateNote`
    * from `packages/backend/src/core/NoteCreateService.ts` to `packages/backend/src/core/NoteEditService.ts`
    * from `packages/backend/src/server/api/endpoints/notes/create.ts` to `packages/backend/src/server/api/endpoints/notes/edit.ts`
    * from MK note components to SK note components (if sensible)
        * from `packages/frontend/src/components/MkNote.vue` to `packages/frontend/src/components/SkNote.vue`
        * from `packages/frontend/src/components/MkNoteDetailed.vue` to `packages/frontend/src/components/SkNoteDetailed.vue`
        * from `packages/frontend/src/components/MkNoteHeader.vue` to `packages/frontend/src/components/SkNoteHeader.vue`
        * from `packages/frontend/src/components/MkNoteSimple.vue` to `packages/frontend/src/components/SkNoteSimple.vue`
        * from `packages/frontend/src/components/MkNoteSub.vue` to `packages/frontend/src/components/SkNoteSub.vue`
    * from MK note components to Dynamic note components (if the public signature changed)
        * from `packages/frontend/src/components/MkNote.vue` to `packages/frontend/src/components/DynamicNote.vue`
        * from `packages/frontend/src/components/MkNoteDetailed.vue` to `packages/frontend/src/components/DynamicNoteDetailed.vue`
        * from `packages/frontend/src/components/MkNoteSimple.vue` to `packages/frontend/src/components/DynamicNoteSimple.vue`
    * from the global timeline to the bubble timeline
        * `packages/backend/src/server/api/stream/channels/global-timeline.ts`
        * `packages/backend/src/server/api/stream/channels/bubble-timeline.ts`
        * `packages/frontend/src/timelines.ts`
        * `packages/frontend/src/components/MkTimeline.vue`
        * `packages/frontend/src/pages/timeline.vue`
        * `packages/frontend/src/ui/deck/tl-column.vue`
        * `packages/frontend/src/widgets/WidgetTimeline.vue`
    * from `packages/backend/src/queue/processors/InboxProcessorService.ts` to `packages/backend/src/core/UpdateInstanceQueue.ts`, where `updateInstanceQueue` is impacted
    * from `.config/example.yml` to `.config/ci.yml` and `chart/files/default.yml`
    * in `packages/backend/src/core/MfmService.ts`, from `toHtml` to `toMastoApiHtml`
    * from `verifyLink` in `packages/backend/src/core/activitypub/models/ApPersonService.ts` to `verifyFieldLinks` in `packages/backend/src/misc/verify-field-link.ts` (if sensible)
* if there have been any changes to the federated user data (the `renderPerson` function in `packages/backend/src/core/activitypub/ApRendererService.ts`), make sure that the set of fields in `userNeedsPublishing` and `profileNeedsPublishing` in `packages/backend/src/server/api/endpoints/i/update.ts` are still correct.
* check the changes against our `develop` (`git diff develop`) and against Misskey (`git diff misskey/develop`)
* re-generate `misskey-js` (`pnpm build-misskey-js-with-types`) and commit
* re-generate locales (`pnpm run build-assets`) and commit
* build the frontend: `rm -rf built/; NODE_ENV=development pnpm --filter=frontend --filter=frontend-embed --filter=frontend-shared build` (the `development` tells it to keep some of the original filenames in the built files)
* make sure there aren't any new `ti-*` classes (Tabler Icons), and replace them with appropriate `ph-*` ones (Phosphor Icons) in [`vite.replaceicons.ts`](packages/frontend/vite.replaceIcons.ts).
    * This command should show you want to change: `grep -ohrP '(?<=["'\''](ti )?)(ti-(?!fw)[\w\-]+)' --exclude \*.map -- built/ | sort -u`.
    * NOTE: `ti-fw` is a special class that's defined by Misskey, leave it alone.
    * After every change, re-build the frontend and check again, until there are no more `ti-*` classes in the built files.
    * Commit!
* double-check the new migration, that they won't conflict with our db changes: `git diff develop -- packages/backend/migration/`
* `pnpm clean; pnpm build`
* run tests `pnpm test; pnpm --filter backend test:e2e` (requires a
  test database, [see above](#testing)) and fix them all (the e2e
  tests randomly fail with weird errors like `relation "users" does
  not exist`, run them again if that happens)
* run lint `pnpm --filter=backend --filter=frontend-shared lint` +
  `pnpm --filter=frontend --filter=frontend-embed eslint` and fix all
  the problems

Then push and open a Merge Request.
