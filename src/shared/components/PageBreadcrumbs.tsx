import { Link, useLocation } from "react-router-dom";
import { withModuleRoot } from "@/shared/lib/moduleHome";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/shared/components/ui/breadcrumb";

export interface BreadcrumbEntry {
  label: string;
  href?: string;
}

export function PageBreadcrumbs({ items: given }: { items: BreadcrumbEntry[] }) {
  // A trail written as "Dashboard > ..." starts at the module the page belongs to instead.
  const items = withModuleRoot(given, useLocation().pathname);
  return (
    <Breadcrumb className="mb-4">
      <BreadcrumbList>
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          return (
            <BreadcrumbItem key={i}>
              {isLast || !item.href ? (
                <BreadcrumbPage>{item.label}</BreadcrumbPage>
              ) : (
                <BreadcrumbLink asChild>
                  <Link to={item.href}>{item.label}</Link>
                </BreadcrumbLink>
              )}
              {!isLast && <BreadcrumbSeparator />}
            </BreadcrumbItem>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
