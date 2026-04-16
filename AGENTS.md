## Agent Development Rules

### Tooling & Workflow (MUST)
- Always use `@antfu/ni`: `ni` to install, `nr <script>` to run scripts, `nun` to uninstall.
- This is a **pnpm monorepo** with libraries in the `packages/` directory.
- After any change to source files, **always run `pnpm build`** before testing or committing.
- Before every commit, run `pnpm check` (which runs lint + format).
- Use **kebab-case** for all filenames.

### TypeScript Rules (MUST)
- Prefer `interface` over `type` aliases.
- Keep **all types and interfaces in the global scope** (avoid inline types).
- Never use type assertions (`as`) unless absolutely necessary.
- Use **arrow functions** exclusively. Never use `function` declarations.

### Code Style & Quality (MUST)
- Use **highly descriptive variable names**. Avoid shorthands and 1-2 character names.
  - Good: `didPositionChange`, `targetElement`, `innerItem`
  - Bad: `moved`, `x`, `el`
- Frequently re-evaluate and refactor variable names for maximum clarity.
- **Default to zero comments**. Only add a comment when the "why" is truly non-obvious (browser quirk, performance tradeoff, fragile hack, or counter-intuitive design).
- Remove all unused code. Strictly follow DRY.
- Put all **magic numbers** in `constants.ts` using `SCREAMING_SNAKE_CASE` with unit suffixes (`TIMEOUT_MS`, `DEFAULT_WIDTH_PX`, etc.).
- Extract small, focused utilities into the `utils/` folder (one utility per file).

### Architecture & Decision Making (MUST)
- Always search the existing codebase thoroughly before adding new code.
- Consider multiple possible solutions, then implement the **most elegant** one (cleanest, most maintainable, least surprising).

### What to Avoid
- Using `!!` for boolean conversion — use `Boolean()` instead.
- Type casting unless truly unavoidable.
- Comments that merely restate what the code or variable names already make obvious.
- Repeating logic across files.

### Testing & Checks
- Run `pnpm check` (lint + format) before every commit.
- `pnpm build` must complete successfully before running the CLI or tests.