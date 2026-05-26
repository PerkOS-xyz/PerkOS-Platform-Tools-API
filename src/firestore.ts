/**
 * Firebase Admin SDK init + cached client.
 *
 * We re-use the connection across requests (cold-start cost is ~100ms);
 * fastify's plugin lifecycle ensures we initialize once at boot, not
 * per-request.
 */

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import { config } from "./config.js";

let cachedDb: Firestore | null = null;

export function db(): Firestore {
  if (cachedDb) return cachedDb;

  if (getApps().length === 0) {
    initializeApp({
      credential: cert({
        projectId: config.FIREBASE_PROJECT_ID,
        clientEmail: config.FIREBASE_CLIENT_EMAIL,
        privateKey: config.FIREBASE_PRIVATE_KEY,
      }),
    });
  }

  cachedDb = getFirestore();
  return cachedDb;
}
