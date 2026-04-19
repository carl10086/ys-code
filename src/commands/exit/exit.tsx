import { Text } from "ink";
import React from "react";
import type { LocalJSXCommandOnDone } from "../../commands/types.js";

const GOODBYE_MESSAGES = ["Goodbye!", "See ya!", "Bye!", "Catch you later!"];

function getRandomGoodbyeMessage(): string {
  return GOODBYE_MESSAGES[Math.floor(Math.random() * GOODBYE_MESSAGES.length)] ?? "Goodbye!";
}

export async function call(
  onDone: LocalJSXCommandOnDone,
): Promise<React.ReactNode> {
  const message = getRandomGoodbyeMessage();
  onDone(message);
  process.exit(0);
  return null;
}
