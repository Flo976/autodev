let currentTicketKey = "";
let silent = false;

export function setCurrentTicket(key) {
  currentTicketKey = key;
}

export function getCurrentTicket() {
  return currentTicketKey;
}

export function setSilent(value) {
  silent = value;
}

export function log(msg) {
  if (silent) return;
  const prefix = currentTicketKey ? `[${currentTicketKey}]` : "[AUTODEV]";
  console.log(`${prefix} ${msg}`);
}

export function logError(msg) {
  if (silent) return;
  const prefix = currentTicketKey ? `[${currentTicketKey}]` : "[AUTODEV]";
  console.error(`${prefix} ERROR: ${msg}`);
}
