import LoadingPanel from "../loading-panel";

// 5 columns: Document, Kind, Expires, Status, File.
export default function Loading() {
  return <LoadingPanel label="your documents" shape="table" columns={5} />;
}
