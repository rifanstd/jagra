#!/usr/bin/env node
import { main } from "./main.js";

process.exitCode = main((line) => console.error(line));
