import instamart from "./instamart-blinkit.json";
import vendor from "./vendor-payment.json";
import onboarding from "./employee-onboarding.json";
import complaint from "./customer-complaint.json";
import order from "./order-to-delivery.json";
import crmAdvance from "./crm-advance-order.json";
import crmCredit from "./crm-credit-order.json";
import poToPayment from "./purchase-po-to-payment.json";
import indent from "./purchase-indent.json";
import exit from "./employee-exit.json";
import leave from "./leave-request.json";
import purchaseFms from "./purchase-fms.json";
import hiring from "./hiring-fms.json";
import inventoryOrder from "./inventory-order-fms.json";
import amazonFba from "./amazon-fba-fms.json";
import flipkartPo from "./flipkart-amazon-po-fms.json";
import reconcileProcess from "./reconcile-process-fms.json";
import reconcileReturn from "./reconcile-return-fms.json";
import productLaunch from "./amazon-product-launch.json";
import fallback from "./assignee-fallback.json";

/** Names used in Drive sheets that are roles / outsiders → the person who does that work in the app. */
export const ASSIGNEE_FALLBACK = fallback as Record<string, string>;

/** Ready-made FMS to start from. `assigneeName` is matched to a user of the same name; otherwise you pick the person. */
export const TEMPLATES = [
  { id: "instamart-blinkit", data: instamart },
  { id: "crm-advance-order", data: crmAdvance },
  { id: "crm-credit-order", data: crmCredit },
  { id: "purchase-po-to-payment", data: poToPayment },
  { id: "purchase-indent", data: indent },
  { id: "purchase-fms", data: purchaseFms },
  { id: "hiring-fms", data: hiring },
  { id: "inventory-order-fms", data: inventoryOrder },
  { id: "amazon-fba-fms", data: amazonFba },
  { id: "flipkart-amazon-po-fms", data: flipkartPo },
  { id: "reconcile-process-fms", data: reconcileProcess },
  { id: "reconcile-return-fms", data: reconcileReturn },
  { id: "amazon-product-launch", data: productLaunch },
  { id: "employee-exit", data: exit },
  { id: "leave-request", data: leave },
  { id: "order-to-delivery", data: order },
  { id: "vendor-payment", data: vendor },
  { id: "employee-onboarding", data: onboarding },
  { id: "customer-complaint", data: complaint },
] as const;

/** The FMS that exist as sheets in the owner's Google Drive (the other templates are generic examples). */
export const DRIVE_TEMPLATE_IDS = [
  "instamart-blinkit", "crm-advance-order", "crm-credit-order", "purchase-fms", "purchase-indent", "purchase-po-to-payment", "hiring-fms", "inventory-order-fms",
  "amazon-fba-fms", "flipkart-amazon-po-fms", "reconcile-process-fms", "reconcile-return-fms", "amazon-product-launch", "employee-exit", "leave-request",
] as const;
