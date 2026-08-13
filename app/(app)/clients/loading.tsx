import LoadingPanel from "../loading-panel";

// 6 columns: Client, Contact, Day rate, Terms, W-9, actions.
export default function Loading() {
  return <LoadingPanel label="your clients" shape="table" columns={6} />;
}
