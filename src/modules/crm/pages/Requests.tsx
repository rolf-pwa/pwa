import { Navigate } from "react-router-dom";

// Client requests now live inside the Ask Georgia inbox, under each client's thread.
export default function Requests() {
  return <Navigate to="/ask-georgia" replace />;
}
