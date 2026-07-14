export function allocateEvenly(amount, participantIds) {
  if (!participantIds.length) return {};

  const normalized = Math.max(0, Math.round(Number(amount) || 0));
  const base = Math.floor(normalized / participantIds.length);
  let remainder = normalized % participantIds.length;

  return Object.fromEntries(
    participantIds.map((id) => {
      const share = base + (remainder > 0 ? 1 : 0);
      remainder = Math.max(0, remainder - 1);
      return [id, share];
    }),
  );
}

export function calculateEqualSplit({ people = [], total = 0 }) {
  const normalizedTotal = Math.max(0, Math.round(Number(total) || 0));
  const ids = people.map((person) => person.id);
  const shares = allocateEvenly(normalizedTotal, ids);

  return {
    total: normalizedTotal,
    results: people.map((person) => {
      const payable = shares[person.id] || 0;
      return {
        ...person,
        itemTotal: payable,
        lineItems: [{
          name: "Chia đều tổng thanh toán",
          quantity: 1,
          amount: payable,
          shared: true,
        }],
        shippingShare: 0,
        surchargeShare: 0,
        discountShare: 0,
        payable,
      };
    }),
  };
}

export function calculateBill({ people = [], items = [], shippingFee = 0, surcharge = 0, discount = 0 }) {
  const ids = people.map((person) => person.id);
  const itemTotals = Object.fromEntries(ids.map((id) => [id, 0]));
  const lineItems = Object.fromEntries(ids.map((id) => [id, []]));
  let subtotal = 0;

  for (const item of items) {
    const quantity = Math.max(1, Math.round(Number(item.quantity) || 1));
    const lineTotal = Math.max(0, Math.round(Number(item.price) || 0)) * quantity;
    subtotal += lineTotal;

    if (item.ownerId === "all") {
      const shares = allocateEvenly(lineTotal, ids);
      ids.forEach((id) => {
        itemTotals[id] += shares[id] || 0;
        lineItems[id].push({
          name: item.name || "Món chưa đặt tên",
          quantity,
          amount: shares[id] || 0,
          shared: true,
        });
      });
    } else if (ids.includes(item.ownerId)) {
      itemTotals[item.ownerId] += lineTotal;
      lineItems[item.ownerId].push({
        name: item.name || "Món chưa đặt tên",
        quantity,
        amount: lineTotal,
        shared: false,
      });
    }
  }

  const shipping = Math.max(0, Math.round(Number(shippingFee) || 0));
  const extraFees = Math.max(0, Math.round(Number(surcharge) || 0));
  const promotion = Math.max(0, Math.round(Number(discount) || 0));
  const shippingShares = allocateEvenly(shipping, ids);
  const surchargeShares = allocateEvenly(extraFees, ids);
  const discountShares = allocateEvenly(promotion, ids);
  const results = people.map((person) => ({
    ...person,
    itemTotal: itemTotals[person.id] || 0,
    lineItems: lineItems[person.id] || [],
    shippingShare: shippingShares[person.id] || 0,
    surchargeShare: surchargeShares[person.id] || 0,
    discountShare: discountShares[person.id] || 0,
    payable:
      (itemTotals[person.id] || 0) +
      (shippingShares[person.id] || 0) +
      (surchargeShares[person.id] || 0) -
      (discountShares[person.id] || 0),
  }));

  return {
    subtotal,
    shippingFee: shipping,
    surcharge: extraFees,
    discount: promotion,
    total: subtotal + shipping + extraFees - promotion,
    results,
  };
}
