const GELATO_API_KEY = process.env.GELATO_API_KEY!;
const GELATO_BASE = "https://api.gelato.com";
const GELATO_PRODUCT_BASE = "https://product.gelatoapis.com";
const PRODUCT_UID = "photobooks-hardcover_pf_200x200-mm-8x8-inch_pt_170-gsm-65lb-coated-silk_cl_4-4_ccl_4-4_bt_glued-left_ct_matt-lamination_prt_1-0_cpt_130-gsm-65-lb-cover-coated-silk_ver";

// Live-confirmed against product.gelatoapis.com/v3/products/{PRODUCT_UID}/cover-dimensions:
// pageCount=27 -> INVALID_NUMBER_OF_PAGES, pageCount=28 -> accepted. Inner pages only.
export const GELATO_MIN_PAGES = 28;
export const GELATO_MAX_PAGES = 200;

type ShippingAddress = {
  name: string;
  address: string;
  city: string;
  state?: string;
  zip: string;
  country: string;
};

type GelatoOrderResult = {
  id: string;
  status: string;
};

type GelatoBox = { width: number; height: number; left: number; top: number };

export type GelatoCoverDimensions = {
  measureUnit: "mm";
  wraparoundInsideSize: GelatoBox & { thickness: number };
  contentFrontSize: GelatoBox;
  contentBackSize: GelatoBox;
  spineSize: GelatoBox;
  jointFrontSize: GelatoBox;
  jointBackSize: GelatoBox;
};

// Spine width is NOT a formula -- confirmed by querying this endpoint across
// the full 28-200 page range: it steps unevenly (e.g. flat 6mm from 28-50
// pages, then 9/11/14/16/18/19mm at higher counts), almost certainly discrete
// case-binding hardware sizes. Always call this live per order.
export async function getCoverDimensions(innerPageCount: number): Promise<GelatoCoverDimensions> {
  const res = await fetch(
    `${GELATO_PRODUCT_BASE}/v3/products/${PRODUCT_UID}/cover-dimensions?pageCount=${innerPageCount}`,
    { headers: { "X-API-KEY": GELATO_API_KEY } }
  );
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Gelato cover-dimensions failed: ${JSON.stringify(json)}`);
  }
  return json;
}

export async function submitToGelato({
  orderId,
  pdfUrl,
  pageCount,
  shipping,
}: {
  orderId: string;
  pdfUrl: string;
  pageCount: number;
  shipping: ShippingAddress;
}): Promise<GelatoOrderResult> {
  const [firstName, ...rest] = shipping.name.trim().split(" ");
  const lastName = rest.join(" ") || "-";

  const body = {
    orderReferenceId: orderId,
    currency: "USD",
    shippingAddress: {
      firstName,
      lastName,
      addressLine1: shipping.address,
      city: shipping.city,
      state: shipping.state ?? "",
      postCode: shipping.zip,
      country: shipping.country,
    },
    items: [
      {
        itemReferenceId: `${orderId}-book`,
        productUid: PRODUCT_UID,
        quantity: 1,
        pagesCount: pageCount,
        fileUrl: pdfUrl,
      },
    ],
  };

  const res = await fetch(`${GELATO_BASE}/v3/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": GELATO_API_KEY,
    },
    body: JSON.stringify(body),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Gelato order failed: ${JSON.stringify(json)}`);
  }

  return { id: json.id, status: json.status };
}
