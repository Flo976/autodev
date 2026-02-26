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

function prefix(config) {
  const key = config?.ticketKey || currentTicketKey;
  return key ? `[${key}]` : "[AUTODEV]";
}

export function log(msg, config) {
  if (silent) return;
  console.log(`${prefix(config)} ${msg}`);
}

export function logError(msg, config) {
  if (silent) return;
  console.error(`${prefix(config)} ERROR: ${msg}`);
}
