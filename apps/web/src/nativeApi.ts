import type { LocalApi } from "@t3tools/contracts";

import { __resetLocalApiForTests, createLocalApi, ensureLocalApi, readLocalApi } from "./localApi";

export type NativeApi = LocalApi;

export const createNativeApi = createLocalApi;
export const readNativeApi = readLocalApi;
export const ensureNativeApi = ensureLocalApi;
export const __resetNativeApiForTests = __resetLocalApiForTests;
