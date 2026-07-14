/**
 * US address splitting moved to @dinosales/types (the web app's cleanup pass
 * needs the identical logic — one implementation, no drift). Re-exported here
 * so desktop imports keep their path.
 */

export { parseUsAddress, type UsAddress } from "@dinosales/types";
