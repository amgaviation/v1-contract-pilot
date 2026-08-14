import LoadingPanel from "../loading-panel";

// 7 columns: Dates, Client, Aircraft, Days, Value, Status, Billing.
export default function Loading() {
  return <LoadingPanel label="your trips" shape="table" columns={7} />;
}
