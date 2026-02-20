let currentTicketKey = "";

export function setCurrentTicket(key) {
  currentTicketKey = key;
}

export function getCurrentTicket() {
  return currentTicketKey;
}

export function log(msg) {
  const prefix = currentTicketKey ? `[${currentTicketKey}]` : "[AUTODEV]";
  console.log(`${prefix} ${msg}`);
}

export function logError(msg) {
  const prefix = currentTicketKey ? `[${currentTicketKey}]` : "[AUTODEV]";
  console.error(`${prefix} ERROR: ${msg}`);
}
