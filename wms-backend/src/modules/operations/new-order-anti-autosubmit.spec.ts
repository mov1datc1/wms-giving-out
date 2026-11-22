describe('Anti-Autosubmit & Explicit Order Creation Protocol', () => {
  interface OrderLineState {
    skuId: string;
    cantidadSolicitada: number | string;
    available: number;
    reserved: number;
    uom: string;
  }

  interface FormState {
    clienteId: string;
    endCustomerId: string;
    fechaCompromiso: string;
    horaCompromiso: string;
    lines: OrderLineState[];
    submitting: boolean;
  }

  let dbOrders: any[];
  let apiPostOrderCalls: any[];

  beforeEach(() => {
    dbOrders = [];
    apiPostOrderCalls = [];
  });

  function simulateCreateOrderApi(payload: any) {
    apiPostOrderCalls.push(payload);
    const newOrder = {
      id: `ord-${dbOrders.length + 1}`,
      codigo: `PED-2026-000${dbOrders.length + 1}`,
      ...payload,
      createdAt: new Date().toISOString(),
    };
    dbOrders.push(newOrder);
    return newOrder;
  }

  // Simulates frontend event handler state machine
  class OrderFormSimulator {
    state: FormState = {
      clienteId: 'cli-alim',
      endCustomerId: 'cust-walmart-01',
      fechaCompromiso: '2026-11-25',
      horaCompromiso: '14:00',
      lines: [],
      submitting: false,
    };

    get isEveryLineValid(): boolean {
      return (
        this.state.lines.length > 0 &&
        this.state.lines.every((l) => {
          if (!l.skuId || String(l.skuId).trim() === '') return false;
          const qty = Number(l.cantidadSolicitada);
          if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty <= 0) return false;
          if (qty > (Number(l.available) || 0)) return false;
          return true;
        })
      );
    }

    get isGeneralInfoValid(): boolean {
      return Boolean(
        this.state.clienteId &&
          this.state.clienteId.trim() !== '' &&
          this.state.endCustomerId &&
          this.state.endCustomerId.trim() !== '' &&
          this.state.fechaCompromiso &&
          this.state.fechaCompromiso.trim() !== '' &&
          this.state.horaCompromiso &&
          this.state.horaCompromiso.trim() !== ''
      );
    }

    get isOrderValid(): boolean {
      return this.isEveryLineValid && this.isGeneralInfoValid;
    }

    addLine(skuId = 'sku-1', available = 50, uom = 'PZA') {
      // Adding line MUST NOT trigger API or create order
      this.state.lines.push({
        skuId,
        cantidadSolicitada: 1,
        available,
        reserved: 0,
        uom,
      });
    }

    updateQty(index: number, val: string | number) {
      // Typing or editing quantity MUST NOT trigger API or create order
      if (this.state.lines[index]) {
        if (val === '') {
          this.state.lines[index].cantidadSolicitada = '';
        } else {
          const parsed = parseInt(String(val).replace(/\D/g, ''), 10);
          this.state.lines[index].cantidadSolicitada = isNaN(parsed) ? '' : parsed;
        }
      }
    }

    setLineSku(index: number, skuId: string) {
      if (this.state.lines[index]) {
        this.state.lines[index].skuId = skuId;
      }
    }

    removeLine(index: number) {
      // Removing line MUST NOT trigger API or create order
      this.state.lines.splice(index, 1);
    }

    handleKeyDown(event: { key: string; targetTag: string; preventDefault: jest.Mock }) {
      // Accidental Enter inside inputs MUST be prevented and CANNOT submit
      if (event.key === 'Enter' && event.targetTag !== 'TEXTAREA') {
        event.preventDefault();
        return; // Stopped, no submit triggered
      }
    }

    handleSubmitExplicit() {
      // Only explicit button click triggers submit and requires isOrderValid
      if (this.state.submitting) return;
      if (!this.isOrderValid) return;

      this.state.submitting = true;
      simulateCreateOrderApi({
        clienteId: this.state.clienteId,
        endCustomerId: this.state.endCustomerId,
        fechaCompromiso: this.state.fechaCompromiso,
        horaCompromiso: this.state.horaCompromiso,
        lineas: this.state.lines.map((l) => ({
          skuId: l.skuId,
          cantidadSolicitada: Number(l.cantidadSolicitada),
          uom: l.uom,
        })),
      });
      this.state.submitting = false;
    }
  }

  it('1. Writing or modifying quantity DOES NOT create any SalesOrder or trigger POST', () => {
    const form = new OrderFormSimulator();
    form.addLine('sku-arroz', 100);

    expect(dbOrders.length).toBe(0);
    expect(apiPostOrderCalls.length).toBe(0);

    // Simulate typing quantities: 5, then 15, then 25, then clearing, then 10
    form.updateQty(0, '5');
    expect(dbOrders.length).toBe(0);
    expect(apiPostOrderCalls.length).toBe(0);

    form.updateQty(0, '15');
    expect(dbOrders.length).toBe(0);
    expect(apiPostOrderCalls.length).toBe(0);

    form.updateQty(0, '25');
    expect(dbOrders.length).toBe(0);
    expect(apiPostOrderCalls.length).toBe(0);

    form.updateQty(0, '');
    expect(dbOrders.length).toBe(0);
    expect(apiPostOrderCalls.length).toBe(0);

    form.updateQty(0, '10');
    expect(dbOrders.length).toBe(0);
    expect(apiPostOrderCalls.length).toBe(0);
    expect(form.state.lines[0].cantidadSolicitada).toBe(10);
  });

  it('2. Adding and removing lines DOES NOT create any SalesOrder or trigger POST', () => {
    const form = new OrderFormSimulator();

    form.addLine('sku-frijol', 40);
    form.addLine('sku-lenteja', 30);
    expect(dbOrders.length).toBe(0);
    expect(apiPostOrderCalls.length).toBe(0);
    expect(form.state.lines.length).toBe(2);

    form.removeLine(0);
    expect(dbOrders.length).toBe(0);
    expect(apiPostOrderCalls.length).toBe(0);
    expect(form.state.lines.length).toBe(1);
    expect(form.state.lines[0].skuId).toBe('sku-lenteja');
  });

  it('3. Pressing Enter inside quantity input calls preventDefault and DOES NOT trigger submit', () => {
    const form = new OrderFormSimulator();
    form.addLine('sku-aceite', 20);
    form.updateQty(0, '5');

    const preventDefaultMock = jest.fn();
    const enterEvent = {
      key: 'Enter',
      targetTag: 'INPUT',
      preventDefault: preventDefaultMock,
    };

    form.handleKeyDown(enterEvent);

    expect(preventDefaultMock).toHaveBeenCalledTimes(1);
    expect(dbOrders.length).toBe(0);
    expect(apiPostOrderCalls.length).toBe(0);
  });

  it('4. ONLY the explicit confirmation button click creates the SalesOrder', () => {
    const form = new OrderFormSimulator();
    form.addLine('sku-harina', 50);
    form.updateQty(0, '12');

    // Still 0 before click
    expect(dbOrders.length).toBe(0);
    expect(form.isOrderValid).toBe(true);

    // User explicitly clicks "Confirmar y Solicitar Pedido"
    form.handleSubmitExplicit();

    expect(dbOrders.length).toBe(1);
    expect(apiPostOrderCalls.length).toBe(1);
    expect(dbOrders[0].codigo).toBe('PED-2026-0001');
    expect(dbOrders[0].lineas[0].skuId).toBe('sku-harina');
    expect(dbOrders[0].lineas[0].cantidadSolicitada).toBe(12);
  });

  it('5. Validation Case A: Line without product + quantity 4 -> button disabled (isOrderValid === false)', () => {
    const form = new OrderFormSimulator();
    // Line added with empty skuId and quantity 4
    form.addLine('', 50);
    form.updateQty(0, '4');

    expect(form.state.lines[0].skuId).toBe('');
    expect(form.state.lines[0].cantidadSolicitada).toBe(4);
    expect(form.isEveryLineValid).toBe(false);
    expect(form.isOrderValid).toBe(false);

    // Explicit submit must be blocked
    form.handleSubmitExplicit();
    expect(dbOrders.length).toBe(0);
    expect(apiPostOrderCalls.length).toBe(0);
  });

  it('6. Validation Case B: Valid product + quantity 0 -> button disabled (isOrderValid === false)', () => {
    const form = new OrderFormSimulator();
    form.addLine('ACE-OLI-1L', 50);
    form.updateQty(0, 0);

    expect(form.state.lines[0].skuId).toBe('ACE-OLI-1L');
    expect(form.state.lines[0].cantidadSolicitada).toBe(0);
    expect(form.isEveryLineValid).toBe(false);
    expect(form.isOrderValid).toBe(false);

    form.handleSubmitExplicit();
    expect(dbOrders.length).toBe(0);
    expect(apiPostOrderCalls.length).toBe(0);
  });

  it('7. Validation Case C: Valid product + quantity negative (-2) -> button disabled (isOrderValid === false)', () => {
    const form = new OrderFormSimulator();
    form.addLine('ACE-OLI-1L', 50);
    form.state.lines[0].cantidadSolicitada = -2;

    expect(form.isEveryLineValid).toBe(false);
    expect(form.isOrderValid).toBe(false);

    form.handleSubmitExplicit();
    expect(dbOrders.length).toBe(0);
    expect(apiPostOrderCalls.length).toBe(0);
  });

  it('8. Validation Case D: Valid product + quantity > available stock -> button disabled (isOrderValid === false)', () => {
    const form = new OrderFormSimulator();
    form.addLine('ACE-OLI-1L', 10); // available is 10
    form.updateQty(0, 15); // requested 15 > 10

    expect(form.state.lines[0].cantidadSolicitada).toBe(15);
    expect(form.isEveryLineValid).toBe(false);
    expect(form.isOrderValid).toBe(false);

    form.handleSubmitExplicit();
    expect(dbOrders.length).toBe(0);
    expect(apiPostOrderCalls.length).toBe(0);
  });

  it('9. Validation Case E: Valid product + valid quantity + general info complete -> button enabled (isOrderValid === true)', () => {
    const form = new OrderFormSimulator();
    form.addLine('ACE-OLI-1L', 50);
    form.updateQty(0, 4);

    expect(form.state.lines[0].skuId).toBe('ACE-OLI-1L');
    expect(form.state.lines[0].cantidadSolicitada).toBe(4);
    expect(form.isEveryLineValid).toBe(true);
    expect(form.isGeneralInfoValid).toBe(true);
    expect(form.isOrderValid).toBe(true);

    form.handleSubmitExplicit();
    expect(dbOrders.length).toBe(1);
    expect(apiPostOrderCalls.length).toBe(1);
    expect(dbOrders[0].lineas[0].cantidadSolicitada).toBe(4);
  });
});
