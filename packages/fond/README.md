# @fnndsc/fond

The neutral base of the mise stack: the small, generic pieces that the engine (`@fnndsc/brasa`), the session host (`@fnndsc/calypso`) and the ChRIS packages all stand on, and that have nothing to do with ChRIS.

The name is from the kitchen, like the rest of the stack: *fonds de cuisine* are the base stocks a kitchen cooks everything else from.

```
npm install @fnndsc/fond
```

## Why it exists

mise is being made backend-neutral: one engine, one session host, one wire and one surface frame, with ChRIS (CUBE) as the first backend among possibly several (see [docs/backend-neutral.adoc](../../docs/backend-neutral.adoc)). For that to be true, the generic pieces cannot live inside a ChRIS package. Before fond, `Result` and the error stack lived in `@fnndsc/cumin`, whose root also loads CUBE's API client, so any layer that wanted an `Ok()` loaded CUBE with it.

fond is where those pieces go instead. Its one rule: **it depends on nothing in `@fnndsc`**. CI holds it to that (`npm run lint:fond`), so a layer that is not about CUBE can use fond without loading CUBE.

## What's in it

| Export | What it is |
| --- | --- |
| `Result<T>`, `Ok`, `Err`, `result_isOk`, `result_isErr` | An explicit success-or-failure value. A function returns `Result<T>` rather than `T \| null`, and TypeScript will not let a caller read `.value` until it has checked `.ok`. |
| `errorStack` | The process-wide message stack that failures are reported on, with context-isolated scopes and checkpoints. |
| `errorStack_configure`, `errorStack_getAllOfType`, `StackMessage` | Configuration, a convenience reader, and the message type. |

The steps after this one add the VFS framework (mount interface and dispatcher) and the output sink and surface interfaces the engine and the session host share.

## Using `Result`

A failure carries no payload of its own: the reason goes on the error stack, where a surface can show it, and the `Result` says only that it failed.

```typescript
import { Ok, Err, errorStack, type Result } from '@fnndsc/fond';

async function config_read(path: string): Promise<Result<Config>> {
  const text: string | null = await file_read(path);
  if (text === null) {
    errorStack.stack_push('error', `No configuration at ${path}.`);
    return Err();
  }
  return Ok(config_parse(text));
}

const config: Result<Config> = await config_read('~/.config/app.yml');
if (!config.ok) {
  // config.value does not exist here; TypeScript says so.
  return;
}
config_apply(config.value);
```

## Using the error stack

`errorStack` is a single instance for the whole process. Each message is stamped with the name of the function that pushed it:

```typescript
errorStack.stack_push('error', 'CUBE refused the login');
errorStack.stack_pop();   // { type: 'error', message: '[login_run          ] | CUBE refused the login' }
```

Reading and clearing:

| Method | Does |
| --- | --- |
| `stack_push(type, message)` | Pushes an `error` or a `warning`. |
| `stack_pop()`, `stack_getAll()` | Takes the newest message; lists them all. |
| `stack_search(text)`, `messagesOfType_search(type, text)` | Finds messages containing some text. |
| `allOfType_get(type)`, `messages_has()`, `messagesOfType_has(type)` | Reads by type; asks whether anything is there. |
| `stack_clear()`, `type_clear(type)` | Empties the stack, or one type. |

Two features keep concurrent work from mixing up its errors:

* **Scopes.** Work run inside `errorStack.scope_run(fn)` pushes to and pops from its own isolated stack, carried by Node's `AsyncLocalStorage` through every `await` inside it. Background work (cache warming, refreshes) runs in a scope so its failures never land in a foreground command's report.
* **Checkpoints.** A command calls `checkpoint_mark()` before it works and `checkpoint_drain(mark)` after, and gets exactly the messages pushed in between.

```typescript
const mark: number = errorStack.checkpoint_mark();
const answer: Result<Listing> = await listing_fetch(path);
const reasons: StackMessage[] = errorStack.checkpoint_drain(mark);
```

`errorStack_configure({ functionNamePadWidth })` sets how wide the function-name stamp is padded.

## One instance, whoever loads it

The error stack only works if the whole process shares one. fond is built as CommonJS, so packages that `require` it (cumin) and packages that `import` it (salsa, brasa, calypso) load the same module and so the same stack. `@fnndsc/cumin` re-exports fond's `Result` and `errorStack` rather than keeping copies, so code that still imports them from cumin shares that stack too. If you bundle code that uses fond, keep it to one copy.

## Where it sits

```
  brasa (engine)    calypso (session host)    cumin, salsa (the ChRIS backend)
        │                     │                          │
        └─────────────────────┼──────────────────────────┘
                              ▼
                      ┌───────────────┐
                      │     fond      │   depends on nothing in @fnndsc
                      └───────────────┘
```

## License

MIT. Part of [mise](https://github.com/FNNDSC/mise).
