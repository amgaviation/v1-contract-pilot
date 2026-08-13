import LoadingPanel from "../loading-panel";

// 6 columns: Dates, Client, Route, Tail, Days, Value.
export default function Loading() {
  return <LoadingPanel label="your trips" shape="table" columns={6} />;
}
