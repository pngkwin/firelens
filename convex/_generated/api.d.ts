/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as crons from "../crons.js";
import type * as firms from "../firms.js";
import type * as http from "../http.js";
import type * as ingest from "../ingest.js";
import type * as ledger from "../ledger.js";
import type * as lib_nrtCore from "../lib/nrtCore.js";
import type * as live from "../live.js";
import type * as pull from "../pull.js";
import type * as regions from "../regions.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  crons: typeof crons;
  firms: typeof firms;
  http: typeof http;
  ingest: typeof ingest;
  ledger: typeof ledger;
  "lib/nrtCore": typeof lib_nrtCore;
  live: typeof live;
  pull: typeof pull;
  regions: typeof regions;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
