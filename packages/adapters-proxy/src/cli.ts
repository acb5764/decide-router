#!/usr/bin/env node
import { DecideProxy } from "./proxy.js";

const port = Number(process.env.PORT ?? 8787);
const upstreamUrl = process.env.UPSTREAM_URL;
const goal = process.env.DECIDE_GOAL;

const proxy = new DecideProxy({
  port,
  upstreamUrl,
  goal,
  bootstrapOnStart: true,
  routingMode: (process.env.ROUTING_MODE as "cascade" | "assist" | "replace" | "guard" | "trigger") ?? "cascade",
});

await proxy.init();
const { port: bound } = await proxy.listen();
console.log(`decide-router-proxy listening on http://127.0.0.1:${bound}`);
