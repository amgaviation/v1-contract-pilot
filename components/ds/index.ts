/**
 * INSTRUMENT — the primitive surface.
 *
 * Stage 2 of the migration in docs/design/INSTRUMENT.md. components/ui
 * re-exports from here once the surface is complete (stage 4); until then
 * both systems coexist so the branch stays shippable at every commit.
 */
export * from "./layout";
export * from "./type";
export * from "./surface";
