import LoadingPanel from "../loading-panel";

// The logbook is this product's widest table — a narrow skeleton under it
// would reflow hard the moment the real columns arrive.
export default function Loading() {
  return <LoadingPanel label="your logbook" shape="table" columns={8} />;
}
