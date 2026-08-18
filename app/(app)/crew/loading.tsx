import LoadingPanel from "../loading-panel";

// 5 columns: Name, Role, Contact, Certificates, actions.
export default function Loading() {
  return <LoadingPanel label="your crew" shape="table" columns={5} />;
}
