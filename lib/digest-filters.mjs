function normalizedSet(values) {
  return new Set((values || []).map((value) => String(value).toLowerCase().trim()).filter(Boolean));
}

function eventTags(event) {
  return Array.isArray(event.tags) ? event.tags.map((tag) => String(tag).toLowerCase().trim()) : [];
}

function hasMoneyPayment(event) {
  return /(?:\p{Sc}\s?\d|\d[\d\s,]*(?:\p{Sc}|грн|uah|usd|eur|gbp|jpy|inr))/iu.test(event.payment || '');
}

function hasFreePriceTier(event) {
  return /(?:^|[^\d])0\s*(?:-|–|—|to)\s*\d/iu.test(event.payment || '');
}

export function isPaidEvent(event) {
  if (!event.payment) return false;
  if (/безкоштов|безоплат|free/i.test(event.payment)) return false;
  if (hasFreePriceTier(event)) return false;
  return hasMoneyPayment(event);
}

export function filterDigestEvents(events, config) {
  const counters = {
    source: 0,
    includeTags: 0,
    excludeTags: 0,
    payment: 0,
    alreadySent: 0,
  };

  const enabledSources = normalizedSet(config.enabledSources);
  const includeTags = normalizedSet(config.includeTags);
  const excludeTags = normalizedSet(config.excludeTags);
  const filtered = [];

  for (const event of events) {
    const sourceIds = Array.isArray(event.sourceIds) && event.sourceIds.length ? event.sourceIds : [event.sourceId];
    const sourceAllowed =
      enabledSources.size === 0 ||
      sourceIds.some((sourceId) => enabledSources.has(String(sourceId).toLowerCase().trim()));
    if (!sourceAllowed) {
      counters.source += 1;
      continue;
    }

    const tags = eventTags(event);
    if (includeTags.size && !tags.some((tag) => includeTags.has(tag))) {
      counters.includeTags += 1;
      continue;
    }

    if (excludeTags.size && tags.some((tag) => excludeTags.has(tag))) {
      counters.excludeTags += 1;
      continue;
    }

    if (config.paymentMode === 'free-or-free-tier' && isPaidEvent(event)) {
      counters.payment += 1;
      continue;
    }

    filtered.push(event);
  }

  return { events: filtered, counters };
}
