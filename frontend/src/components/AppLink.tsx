import { Link, useLocation, type LinkProps } from "react-router-dom";
import { withStore } from "../lib/navigation";

export function AppLink({ to, ...props }: Omit<LinkProps, "to"> & { to: string }) {
  const { search } = useLocation();
  return <Link {...props} to={withStore(to, search)} />;
}
