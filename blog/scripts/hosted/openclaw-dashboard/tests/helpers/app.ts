import supertest from "supertest";
import { getDb, resetDb } from "../../src/services/db";
import app from "../../src/app";

export function getTestApp() {
  return supertest(app);
}

export function freshDb() {
  resetDb();
  getDb(); // re-initialize with fresh in-memory DB
}
