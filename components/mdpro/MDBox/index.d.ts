// Hand-written declaration for the untyped ported .js module: its forwardRef
// render fn has an implicitly-any props param, which TS otherwise infers as
// EMPTY props ({}), breaking every strict .tsx call-site. (A wildcard
// `declare module "@/components/mdpro/*"` cannot fix this — resolved real
// files take precedence over ambient pattern modules, so a sibling .d.ts is
// the mechanism that actually wins resolution.)
import type { ForwardRefExoticComponent } from "react";

declare const MDBox: ForwardRefExoticComponent<any>;
export default MDBox;
