import LoadingPanel from "../loading-panel";

// 7 columns: Date, Category, Vendor, Trip, Amount, Treatment, Receipt.
export default function Loading() {
  return <LoadingPanel label="your expenses" shape="table" columns={7} />;
}
