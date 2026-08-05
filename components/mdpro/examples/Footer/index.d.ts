// Sibling declaration (see components/mdpro/MDBox/index.d.ts for the
// pattern): the .js default `company = { href, name }` makes TS require
// href, but this app's footer passes an attribution name with no link.
import type { FunctionComponent } from "react";

declare const Footer: FunctionComponent<{
  company?: { href?: string; name?: string };
  links?: { href: string; name: string }[];
}>;
export default Footer;
