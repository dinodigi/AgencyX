import { test } from "node:test";
import assert from "node:assert/strict";
import { extractPlaceIds, bestPlaceId, parseStars, parseReviews, parsePhone } from "../src/main/scraper/selectors.ts";

// A real Maps place href captured in the 2026-07-13 fresh-session recon.
const HREF =
  "https://www.google.com/maps/place/Imperium+Plumbing+Hollywood/data=!4m7!3m6!1s0x80c2bf889c2c5b51:0x3aeadceb220d5374!8m2!3d33.786671!4d-118.324015!16s%2Fg%2F11fjzy8d41!19sChIJUVssnIi_woARdFMNIuvc6jo?authuser=0&hl=en&rclk=1";

test("extractPlaceIds pulls the /g/ MID and the CID from a place href", () => {
  const { mid, cid } = extractPlaceIds(HREF);
  assert.equal(mid, "/g/11fjzy8d41");
  assert.equal(cid, "0x80c2bf889c2c5b51:0x3aeadceb220d5374");
});

test("bestPlaceId prefers the MID, then CID, then a name slug", () => {
  assert.equal(bestPlaceId(HREF, "Imperium Plumbing"), "/g/11fjzy8d41");
  const cidOnly = "https://www.google.com/maps/place/X/data=!3m6!1s0x1:0x2!8m2";
  assert.equal(bestPlaceId(cidOnly, "X"), "0x1:0x2");
  assert.equal(bestPlaceId("https://www.google.com/maps/place/Joes", "Joe's Bar"), "name:joe's-bar");
});

test("parseStars accepts a valid 0–5 rating and rejects noise", () => {
  assert.equal(parseStars("4.6 stars"), 4.6);
  assert.equal(parseStars("5.0 stars "), 5);
  assert.equal(parseStars("1 star"), 1);
  assert.equal(parseStars("6 stars"), undefined); // out of range
  assert.equal(parseStars("5 stars, 41 reviews"), undefined); // histogram row, not anchored
  assert.equal(parseStars(null), undefined);
});

test("parseReviews reads only a standalone review count", () => {
  assert.equal(parseReviews("41 reviews"), 41);
  assert.equal(parseReviews("1,234 reviews"), 1234);
  assert.equal(parseReviews("1 review"), 1);
  assert.equal(parseReviews("5 stars, 41 reviews"), undefined); // not anchored
  assert.equal(parseReviews("Reviews for X"), undefined);
});

test("parsePhone prefers the aria-label, falls back to the tel data-item-id", () => {
  assert.equal(parsePhone("Phone: (213) 468-8333", "phone:tel:+12134688333"), "(213) 468-8333");
  assert.equal(parsePhone(null, "phone:tel:+12134688333"), "+12134688333");
  assert.equal(parsePhone(null, null), undefined);
});
