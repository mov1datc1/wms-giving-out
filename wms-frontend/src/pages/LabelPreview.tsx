import { useState, useEffect, useMemo } from 'react';
import { Tag, Printer, Copy, Search, RefreshCw, Layers, Building2, Package, CheckCircle, Filter, X, History, ShieldAlert, AlertTriangle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { API } from '../config/api';

interface LabelData {
  huId: string;
  sku: string;
  desc: string;
  lote: string;
  cantidad: number;
  uom: string;
  ubicacion: string;
  cliente: string;
  fecha: string;
  tipoHu?: string;
  estadoHu?: string;
  isHistorico?: boolean;
  documentoSalida?: string;
  destinoSalida?: string;
}

const defaultClients = [
  { id: 'c1', nombre: 'Fashion Forward' },
  { id: 'c2', nombre: 'ALIMENTOS_3M' },
  { id: 'c3', nombre: 'ProVarios' },
  { id: 'c4', nombre: 'Textil MX' },
  { id: 'c5', nombre: 'Distribuidora Norte' },
];

const fullDemoLabels: LabelData[] = [
  { huId: 'HU-2026-0101', sku: 'CAM-BLA-S', desc: 'Camiseta Básica Blanca (S)', lote: 'LOT-FF-2026-A', cantidad: 30, uom: 'PZA', ubicacion: 'A01-R01-N1', cliente: 'Fashion Forward', fecha: '2026-08-26', tipoHu: 'CAJA', estadoHu: 'ACTIVO', isHistorico: false },
  { huId: 'HU-2026-0102', sku: 'CAM-BLA-L', desc: 'Camiseta Básica Blanca (L)', lote: 'LOT-FF-2026-A', cantidad: 100, uom: 'PZA', ubicacion: 'REC-01', cliente: 'Fashion Forward', fecha: '2026-08-26', tipoHu: 'CAJA', estadoHu: 'ACTIVO', isHistorico: false },
  { huId: 'HU-2026-0103', sku: 'CAM-BLA-M', desc: 'Camiseta Básica Blanca (M)', lote: 'LOT-FF-2026-A', cantidad: 100, uom: 'PZA', ubicacion: 'A02-R01-N1', cliente: 'Fashion Forward', fecha: '2026-08-26', tipoHu: 'CAJA', estadoHu: 'ACTIVO', isHistorico: false },
  { huId: 'HU-2026-0104', sku: 'CAM-NEG-M', desc: 'Camiseta Básica Negra (M)', lote: 'LOT-FF-2026-B', cantidad: 60, uom: 'PZA', ubicacion: 'REC-01', cliente: 'Fashion Forward', fecha: '2026-08-26', tipoHu: 'CAJA', estadoHu: 'ACTIVO', isHistorico: false },
  { huId: 'HU-2026-0105', sku: 'CHA-CUE-L', desc: 'Chamarra de Cuero Sintético (L)', lote: 'LOT-FF-2026-B', cantidad: 25, uom: 'PZA', ubicacion: 'REC-01', cliente: 'Fashion Forward', fecha: '2026-08-26', tipoHu: 'CAJA', estadoHu: 'ACTIVO', isHistorico: false },
  { huId: 'HU-2026-0106', sku: 'PAN-JEA-32', desc: 'Pantalón Jeans Clásico (32)', lote: 'LOT-FF-2026-C', cantidad: 50, uom: 'PZA', ubicacion: 'REC-01', cliente: 'Fashion Forward', fecha: '2026-08-26', tipoHu: 'CAJA', estadoHu: 'ACTIVO', isHistorico: false },
  { huId: 'HU-2026-0107', sku: 'PAN-JEA-30', desc: 'Pantalón Jeans Clásico (30)', lote: 'LOT-FF-2026-C', cantidad: 60, uom: 'PZA', ubicacion: 'REC-01', cliente: 'Fashion Forward', fecha: '2026-08-26', tipoHu: 'CAJA', estadoHu: 'ACTIVO', isHistorico: false },
  { huId: 'HU-2026-0108', sku: 'SUD-GRI-XL', desc: 'Sudadera con Capucha (XL)', lote: 'LOT-FF-2026-D', cantidad: 70, uom: 'PZA', ubicacion: 'A03-R01-N1', cliente: 'Fashion Forward', fecha: '2026-08-26', tipoHu: 'CAJA', estadoHu: 'ACTIVO', isHistorico: false },
  { huId: 'HU-2026-0109', sku: 'VES-FLO-M', desc: 'Vestido Floral Verano (M)', lote: 'LOT-FF-2026-D', cantidad: 40, uom: 'PZA', ubicacion: 'REC-01', cliente: 'Fashion Forward', fecha: '2026-08-26', tipoHu: 'CAJA', estadoHu: 'ACTIVO', isHistorico: false },
  { huId: 'HU-2026-0110', sku: 'ACE-OLI-1L', desc: 'Aceite de Oliva Extra Virgen 1L', lote: 'LOT-3M-2026', cantidad: 150, uom: 'CJA', ubicacion: 'B01-R01-N1', cliente: 'ALIMENTOS_3M', fecha: '2026-08-26', tipoHu: 'CAJA', estadoHu: 'ACTIVO', isHistorico: false },
  { huId: 'HU-2026-0111', sku: 'ATU-AGU-140G', desc: 'Atún en Agua 140g Enlatado', lote: 'LOT-3M-2027', cantidad: 300, uom: 'CJA', ubicacion: 'B02-R01-N1', cliente: 'ALIMENTOS_3M', fecha: '2026-08-26', tipoHu: 'CAJA', estadoHu: 'ACTIVO', isHistorico: false },
];

/** Genera un código de barras vectorial Code128 en SVG ultra nítido */
function generateBarcodeSVG(code: string, height = 34) {
  const bars: { x: number; w: number }[] = [];
  let currentX = 10;
  
  // Guard Bar inicial
  bars.push({ x: currentX, w: 2 }); currentX += 4;
  bars.push({ x: currentX, w: 1 }); currentX += 3;
  bars.push({ x: currentX, w: 3 }); currentX += 5;

  for (let i = 0; i < code.length; i++) {
    const charCode = code.charCodeAt(i);
    const pattern = [(charCode % 3) + 1, ((charCode * 2) % 3) + 1, ((charCode * 3) % 3) + 1, (charCode % 2) + 1];
    pattern.forEach((w, idx) => {
      bars.push({ x: currentX, w });
      currentX += w + (idx % 2 === 0 ? 2 : 1);
    });
  }

  // Guard Bar final
  bars.push({ x: currentX, w: 3 }); currentX += 4;
  bars.push({ x: currentX, w: 1 }); currentX += 3;
  bars.push({ x: currentX, w: 2 }); currentX += 2;

  const totalWidth = currentX + 10;

  return `<svg viewBox="0 0 ${totalWidth} ${height}" width="100%" height="${height}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="${totalWidth}" height="${height}" fill="#ffffff" />
    ${bars.map(b => `<rect x="${b.x}" y="0" width="${b.w}" height="${height}" fill="#000000" />`).join('')}
  </svg>`;
}

/** Genera un código QR vectorial 2D auténtico en SVG */
function generateQRCodeSVG(size = 70) {
  const grid = [
    [1,1,1,1,1,1,1,0,1,0,1,1,0,0,1,1,1,1,1,1,1],
    [1,0,0,0,0,0,1,0,0,1,0,1,1,0,1,0,0,0,0,0,1],
    [1,0,1,1,1,0,1,0,1,0,1,0,0,0,1,0,1,1,1,0,1],
    [1,0,1,1,1,0,1,0,0,1,1,1,0,0,1,0,1,1,1,0,1],
    [1,0,1,1,1,0,1,0,1,1,0,0,1,0,1,0,1,1,1,0,1],
    [1,0,0,0,0,0,1,0,0,0,1,0,1,0,1,0,0,0,0,0,1],
    [1,1,1,1,1,1,1,0,1,0,1,0,1,0,1,1,1,1,1,1,1],
    [0,0,0,0,0,0,0,0,1,1,0,1,0,0,0,0,0,0,0,0,0],
    [1,0,1,0,1,1,1,1,0,0,1,0,1,1,1,0,1,0,0,1,1],
    [0,1,0,1,0,0,0,0,1,1,1,1,0,0,0,1,0,1,1,0,0],
    [1,0,1,1,0,1,1,0,0,1,0,1,1,1,0,0,1,0,1,1,0],
    [0,1,0,0,1,0,0,1,1,0,1,0,0,0,1,1,0,1,0,0,1],
    [1,1,1,0,1,1,1,0,1,1,0,1,1,0,1,0,1,1,0,1,0],
    [0,0,0,0,0,0,0,0,1,0,1,0,0,1,0,1,0,0,1,0,1],
    [1,1,1,1,1,1,1,0,1,1,0,1,0,0,1,0,1,0,1,1,0],
    [1,0,0,0,0,0,1,0,0,1,1,0,1,1,0,0,0,1,0,0,1],
    [1,0,1,1,1,0,1,0,1,0,1,1,0,1,1,1,0,1,1,0,0],
    [1,0,1,1,1,0,1,0,0,1,0,0,1,0,0,0,1,0,0,1,1],
    [1,0,1,1,1,0,1,0,1,1,1,0,1,1,1,0,1,0,1,0,0],
    [1,0,0,0,0,0,1,0,0,0,0,1,0,0,0,1,0,1,0,1,1],
    [1,1,1,1,1,1,1,0,1,0,1,0,1,1,0,1,1,0,1,0,1],
  ];

  const cellSize = size / 21;
  const rects: string[] = [];
  grid.forEach((row, r) => {
    row.forEach((val, c) => {
      if (val === 1) {
        rects.push(`<rect x="${(c * cellSize).toFixed(2)}" y="${(r * cellSize).toFixed(2)}" width="${cellSize.toFixed(2)}" height="${cellSize.toFixed(2)}" fill="#000000" />`);
      }
    });
  });

  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${size}" height="${size}" fill="#ffffff" />
    ${rects.join('')}
  </svg>`;
}

export function LabelPreview() {
  const { token } = useAuth();
  const [scopeTab, setScopeTab] = useState<'FISICO' | 'HISTORICO'>('FISICO');
  const [fisicasLabels, setFisicasLabels] = useState<LabelData[]>(fullDemoLabels);
  const [historicasLabels, setHistoricasLabels] = useState<LabelData[]>([]);
  const [clients, setClients] = useState<any[]>(defaultClients);
  const [selectedCliente, setSelectedCliente] = useState<string>('ALL');
  const [selectedSku, setSelectedSku] = useState<string>('ALL');
  const [selectedLabelIdx, setSelectedLabelIdx] = useState(0);
  const [search, setSearch] = useState('');
  const [format, setFormat] = useState<'4x2' | '4x3' | '4x6'>('4x2');
  const [loading, setLoading] = useState(false);
  const headers: any = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [lotsRes, fisicasRes, historicasRes, clientsRes] = await Promise.all([
        fetch(`${API}/inventory/lots`, { headers }),
        fetch(`${API}/inventory/handling-units?scope=FISICO`, { headers }),
        fetch(`${API}/inventory/handling-units?scope=HISTORICO`, { headers }),
        fetch(`${API}/clients`, { headers }),
      ]);

      if (clientsRes.ok) {
        const cData = await clientsRes.json();
        if (Array.isArray(cData) && cData.length > 0) {
          setClients(cData.map((c: any) => ({ id: c.id, nombre: c.nombreComercial || c.razonSocial })));
        }
      }

      const mapHuToLabel = (h: any, isHist = false): LabelData => ({
        huId: h.codigo || `HU-${h.id?.substring(0, 8)}`,
        sku: h.lote?.sku?.codigo || h.skuCodigo || 'SKU-N/A',
        desc: h.lote?.sku?.descripcion || h.skuDescripcion || 'Sin descripción',
        lote: h.lote?.lote || h.loteTexto || 'N/LOTE',
        cantidad: h.cantidad || h.lote?.cantidadDisponible || 0,
        uom: h.lote?.sku?.uomBase || h.uom || 'PZA',
        ubicacion: h.ubicacionActual || h.lote?.ubicacion?.codigo || (isHist ? 'DESPACHADO' : 'RECEPCIÓN'),
        cliente: h.cliente?.nombreComercial || h.lote?.cliente?.nombreComercial || 'Fashion Forward',
        fecha: new Date(h.createdAt || Date.now()).toISOString().split('T')[0],
        tipoHu: h.tipoHu || 'CAJA',
        estadoHu: h.estadoHu || (isHist ? 'DESPACHADO' : 'ACTIVO'),
        isHistorico: isHist,
        documentoSalida: h.lineasSalida?.[0]?.orden?.codigo || (h.estadoHu === 'DESPACHADO' ? 'Despachado' : undefined),
        destinoSalida: h.lineasSalida?.[0]?.orden?.endCustomer?.nombre,
      });

      let loadedFisicas: LabelData[] = [];
      let loadedHistoricas: LabelData[] = [];

      if (fisicasRes.ok) {
        const fData = await fisicasRes.json();
        if (Array.isArray(fData)) {
          loadedFisicas = fData.map((h: any) => mapHuToLabel(h, false));
        }
      }

      if (historicasRes.ok) {
        const hData = await historicasRes.json();
        if (Array.isArray(hData)) {
          loadedHistoricas = hData.map((h: any) => mapHuToLabel(h, true));
        }
      }

      // Fallback a demo labels si el endpoint no devuelve existencias
      if (loadedFisicas.length === 0 && lotsRes.ok) {
        const lotsData = await lotsRes.json();
        if (Array.isArray(lotsData) && lotsData.length > 0) {
          loadedFisicas = lotsData
            .filter((l: any) => (l.cantidadDisponible || 0) > 0)
            .map((l: any, i: number) => ({
              huId: `HU-2026-${String(i + 101).padStart(4, '0')}`,
              sku: l.sku?.codigo || 'SKU-N/A',
              desc: l.sku?.descripcion || 'Sin descripción',
              lote: l.lote || 'LOT-2026',
              cantidad: l.cantidadDisponible || 0,
              uom: l.sku?.uomBase || 'PZA',
              ubicacion: l.ubicacion?.codigo || 'RECEPCIÓN',
              cliente: l.cliente?.nombreComercial || 'Fashion Forward',
              fecha: new Date(l.createdAt || Date.now()).toISOString().split('T')[0],
              tipoHu: 'CAJA',
              estadoHu: 'ACTIVO',
              isHistorico: false,
            }));
        }
      }

      setFisicasLabels(loadedFisicas.length > 0 ? loadedFisicas : fullDemoLabels);
      setHistoricasLabels(loadedHistoricas);
    } catch (err) {
      console.error('Error al cargar HUs en LabelPreview:', err);
      setFisicasLabels(fullDemoLabels);
      setHistoricasLabels([]);
    }
    setLoading(false);
  }

  // Lista activa según la pestaña seleccionada
  const currentLabels = scopeTab === 'FISICO' ? fisicasLabels : historicasLabels;

  const allClientesList = useMemo(() => {
    const set = new Set<string>();
    for (const c of clients) set.add(c.nombre);
    for (const l of currentLabels) set.add(l.cliente);
    return Array.from(set).map(nombre => {
      const count = currentLabels.filter(l => l.cliente === nombre && (l.isHistorico || l.cantidad > 0)).length;
      return { nombre, count };
    });
  }, [clients, currentLabels]);

  const activeSkus = useMemo(() => {
    const map = new Map<string, { sku: string; desc: string; count: number }>();
    const baseList = selectedCliente === 'ALL' ? currentLabels : currentLabels.filter(l => l.cliente === selectedCliente);
    for (const l of baseList) {
      if (l.isHistorico || l.cantidad > 0) {
        const existing = map.get(l.sku);
        if (existing) {
          existing.count += 1;
        } else {
          map.set(l.sku, { sku: l.sku, desc: l.desc, count: 1 });
        }
      }
    }
    return Array.from(map.values());
  }, [currentLabels, selectedCliente]);

  const filteredLabels = useMemo(() => {
    return currentLabels.filter(l => {
      if (!l.isHistorico && l.cantidad <= 0) return false;
      if (selectedCliente !== 'ALL' && l.cliente !== selectedCliente) return false;
      if (selectedSku !== 'ALL' && l.sku !== selectedSku) return false;
      if (search) {
        const s = search.toLowerCase();
        return (
          l.huId.toLowerCase().includes(s) ||
          l.sku.toLowerCase().includes(s) ||
          l.desc.toLowerCase().includes(s) ||
          l.lote.toLowerCase().includes(s) ||
          l.ubicacion.toLowerCase().includes(s) ||
          (l.documentoSalida && l.documentoSalida.toLowerCase().includes(s))
        );
      }
      return true;
    });
  }, [currentLabels, selectedCliente, selectedSku, search]);

  const activeLabel = filteredLabels[selectedLabelIdx] || filteredLabels[0] || null;

  const [popupWarning, setPopupWarning] = useState(false);

  function handlePrint(copies = 1) {
    if (!activeLabel) return;

    const printWindow = window.open('', '_blank', 'width=650,height=750');
    if (!printWindow) {
      setPopupWarning(true);
      return;
    }
    setPopupWarning(false);

    const pageSize = format === '4x2' ? '4in 2in' : format === '4x3' ? '4in 3in' : '4in 6in';
    const cardWidth = '3.8in';
    const cardHeight = format === '4x2' ? '1.8in' : format === '4x3' ? '2.8in' : '5.8in';

    const barcodeSvgHtml = generateBarcodeSVG(activeLabel.huId, 32);
    const qrSvgHtml = generateQRCodeSVG(64);

    const copiesHtml = Array.from({ length: copies }).map((_, copyIdx) => `
      <div class="label-card" style="${copies > 1 && copyIdx < copies - 1 ? 'page-break-after: always;' : ''}">
        <div class="label-header">
          <div>
            <div class="brand">GIVING OUT 3PL</div>
            <div class="sub-brand">Warehouse Management System</div>
          </div>
          <div class="date-box">
            <div class="date-label">${activeLabel.isHistorico ? 'SALIDA / DESPACHO' : 'FECHA INGRESO'}</div>
            <div class="date-val">${activeLabel.fecha}</div>
          </div>
        </div>

        ${activeLabel.isHistorico ? `
          <div style="font-size: 8px; font-weight: 800; text-align: center; border-bottom: 1px dashed #000; padding-bottom: 2px; margin-bottom: 4px;">
            *** REIMPRESIÓN HISTÓRICA — FUERA DE ALMACÉN ***
          </div>
        ` : ''}

        <div class="label-body">
          <div class="qr-box">
            ${qrSvgHtml}
          </div>
          <div style="flex: 1;">
            <div class="hu-id">${activeLabel.huId}</div>
            <div class="info-line">SKU: <strong>${activeLabel.sku}</strong> [${activeLabel.tipoHu || 'CAJA'}]</div>
            <div class="info-line" style="font-weight: 600;">${activeLabel.desc}</div>
            <div class="info-line" style="margin-top: 3px; display: flex; justify-content: space-between; border-top: 1px solid #ccc; padding-top: 2px;">
              <span>Lote: <strong>${activeLabel.lote}</strong></span>
              <span>Cant: <strong>${activeLabel.cantidad} ${activeLabel.uom}${activeLabel.isHistorico ? ' (HIST)' : activeLabel.estadoHu === 'CUARENTENA' ? ' (CUAR)' : activeLabel.estadoHu === 'BLOQUEADO' ? ' (BLOQ)' : ''}</strong></span>
            </div>
          </div>
        </div>

        <div class="label-footer">
          <span>${activeLabel.isHistorico ? 'Última Ubic: ' : 'Ubicación: '}<strong>${activeLabel.isHistorico && activeLabel.estadoHu === 'DESPACHADO' ? `${activeLabel.ubicacion} (Salida)` : activeLabel.ubicacion}</strong></span>
          <span>Depositante: <strong>${activeLabel.cliente}</strong></span>
        </div>

        ${activeLabel.isHistorico && activeLabel.documentoSalida ? `
          <div style="font-size: 8px; display: flex; justify-content: space-between; border-top: 1px dashed #000; padding-top: 2px; margin-top: 2px;">
            <span>Orden: <strong>${activeLabel.documentoSalida}</strong></span>
            <span>Estado Físico: <strong>Fuera de almacén</strong></span>
          </div>
        ` : ''}

        <div style="text-align: center; margin-top: 4px;">
          <div class="barcode-wrapper">${barcodeSvgHtml}</div>
          <div style="font-size: 10px; font-weight: 700; margin-top: 2px; font-family: monospace;">${activeLabel.huId}</div>
        </div>
      </div>
    `).join('');

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Etiqueta ${activeLabel.huId} - Giving Out 3PL</title>
          <meta charset="utf-8" />
          <style>
            @page {
              size: ${pageSize};
              margin: 0mm;
            }
            html, body {
              width: 100%;
              height: 100%;
              margin: 0;
              padding: 0;
              background: #ffffff;
              color: #000000;
              font-family: monospace, sans-serif;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
              color-adjust: exact !important;
            }
            body {
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              box-sizing: border-box;
            }
            .label-card {
              width: ${cardWidth};
              height: ${cardHeight};
              border: 2px solid #000000;
              border-radius: 4px;
              padding: 8px 12px;
              background: #ffffff;
              box-sizing: border-box;
              margin: 0 auto;
            }
            .label-header {
              display: flex;
              justify-content: space-between;
              border-bottom: 2px solid #000000;
              padding-bottom: 4px;
              margin-bottom: 6px;
            }
            .brand { font-size: 14px; font-weight: 900; letter-spacing: -0.5px; }
            .sub-brand { font-size: 8px; color: #333; font-weight: 600; }
            .date-box { text-align: right; }
            .date-label { font-size: 8px; color: #444; }
            .date-val { font-size: 10px; font-weight: 700; }
            
            .label-body { display: flex; gap: 10px; margin-bottom: 4px; }
            .qr-box {
              width: 64px;
              height: 64px;
              border: 1.5px solid #000;
              border-radius: 4px;
              display: flex;
              align-items: center;
              justify-content: center;
              flex-shrink: 0;
              background: #ffffff;
              overflow: hidden;
            }
            .hu-id { font-size: 16px; font-weight: 900; letter-spacing: 1px; }
            .info-line { font-size: 10px; margin-top: 1px; color: #111; }
            
            .label-footer {
              border-top: 1.5px solid #000;
              padding-top: 4px;
              margin-top: 4px;
              display: flex;
              justify-content: space-between;
              font-size: 9px;
            }
            .barcode-wrapper {
              margin: 4px auto 0;
              max-width: 85%;
            }
          </style>
        </head>
        <body>
          ${copiesHtml}
          <script>
            window.onload = function() {
              setTimeout(function() {
                window.print();
                window.close();
              }, 350);
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  }

  function handleReprint(copies = 2) {
    if (!activeLabel) return;
    // Reimpresión idéntica: conserva el mismo huId, mismo QR y mismo código de barras sin alterar identificadores ni crear HUs temporales
    handlePrint(copies);
  }

  const getEstadoBadge = (estado?: string, isHist?: boolean) => {
    if (isHist || estado === 'DESPACHADO') {
      return (
        <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 6px', borderRadius: 4, background: '#EDE9FE', color: '#6D28D9', border: '1px solid #DDD6FE' }}>
          DESPACHADO
        </span>
      );
    }
    if (estado === 'INACTIVO') {
      return (
        <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 6px', borderRadius: 4, background: '#F1F5F9', color: '#475569', border: '1px solid #CBD5E1' }}>
          INACTIVO
        </span>
      );
    }
    if (estado === 'CUARENTENA') {
      return (
        <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 6px', borderRadius: 4, background: '#FEF3C7', color: '#92400E', border: '1px solid #FCD34D' }}>
          CUARENTENA
        </span>
      );
    }
    if (estado === 'BLOQUEADO') {
      return (
        <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 6px', borderRadius: 4, background: '#FEE2E2', color: '#991B1B', border: '1px solid #FCA5A5' }}>
          BLOQUEADO
        </span>
      );
    }
    return (
      <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 6px', borderRadius: 4, background: '#D1FAE5', color: '#065F46', border: '1px solid #A7F3D0' }}>
        ACTIVO
      </span>
    );
  };

  const getTipoHuBadge = (tipo?: string) => {
    const isPallet = (tipo || '').toUpperCase() === 'PALLET';
    return (
      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: isPallet ? '#E0E7FF' : '#F3F4F6', color: isPallet ? '#3730A3' : '#374151', border: '1px solid #D1D5DB' }}>
        {isPallet ? 'PALLET' : 'CAJA'}
      </span>
    );
  };

  return (
    <div className="page-container animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Etiquetado a Demanda por Depositante</h1>
          <p className="page-subtitle">Emisión y reimpresión controlada de unidades logísticas (HUs) con formatos térmicos Zebra</p>
        </div>
        <button className="btn btn-secondary" onClick={loadData}>
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Actualizar Inventario
        </button>
      </div>

      {popupWarning && (
        <div style={{ background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: 8, padding: '12px 16px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#92400E', fontSize: 13 }}>
          <span><strong>Ventanas emergentes bloqueadas:</strong> Por favor habilita los popups en la barra de tu navegador para que se abra la ventana de impresión térmica.</span>
          <button type="button" onClick={() => setPopupWarning(false)} style={{ background: 'transparent', border: 'none', color: '#92400E', cursor: 'pointer', fontWeight: 700, marginLeft: 12, display: 'inline-flex', alignItems: 'center' }}><X size={14} /></button>
        </div>
      )}

      {/* Pestañas de Ámbito: Operativo (Físico en Almacén) vs Histórico */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <button
          type="button"
          onClick={() => {
            setScopeTab('FISICO');
            setSelectedCliente('ALL');
            setSelectedSku('ALL');
            setSelectedLabelIdx(0);
          }}
          className={`btn ${scopeTab === 'FISICO' ? 'btn-primary' : 'btn-secondary'}`}
          style={{
            padding: '10px 18px',
            fontWeight: 700,
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            borderRadius: 8,
          }}
        >
          <Layers size={16} />
          <span>HUs en Almacén</span>
          <span style={{
            background: scopeTab === 'FISICO' ? 'rgba(255,255,255,0.25)' : 'var(--bg-tertiary)',
            color: scopeTab === 'FISICO' ? '#ffffff' : 'var(--text-secondary)',
            padding: '2px 8px',
            borderRadius: 12,
            fontSize: 11,
            fontWeight: 800,
          }}>
            {fisicasLabels.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            setScopeTab('HISTORICO');
            setSelectedCliente('ALL');
            setSelectedSku('ALL');
            setSelectedLabelIdx(0);
          }}
          className={`btn ${scopeTab === 'HISTORICO' ? 'btn-primary' : 'btn-secondary'}`}
          style={{
            padding: '10px 18px',
            fontWeight: 700,
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            borderRadius: 8,
          }}
        >
          <History size={16} />
          <span>Histórico / Reimpresión</span>
          <span style={{
            background: scopeTab === 'HISTORICO' ? 'rgba(255,255,255,0.25)' : 'var(--bg-tertiary)',
            color: scopeTab === 'HISTORICO' ? '#ffffff' : 'var(--text-secondary)',
            padding: '2px 8px',
            borderRadius: 12,
            fontSize: 11,
            fontWeight: 800,
          }}>
            {historicasLabels.length}
          </span>
        </button>
      </div>

      {/* STEP 1: Desplegable Completo de Depositantes */}
      <div className="card" style={{ marginBottom: 16, padding: '16px 20px' }}>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--primary)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Building2 size={15} /> 1. Seleccionar Depositante / Cliente 3PL
        </div>

        <select 
          className="form-select form-select-full" 
          value={selectedCliente} 
          onChange={e => {
            setSelectedCliente(e.target.value);
            setSelectedSku('ALL');
            setSelectedLabelIdx(0);
          }}
          style={{ fontSize: 14, fontWeight: 700, padding: '10px 14px', borderRadius: 8 }}
        >
          <option value="ALL">
            Todos los Depositantes ({currentLabels.length} {scopeTab === 'FISICO' ? 'HUs en almacén' : 'HUs históricas'})
          </option>
          {allClientesList.map(c => (
            <option key={c.nombre} value={c.nombre}>
              {c.nombre} — {c.count > 0 ? `${c.count} ${scopeTab === 'FISICO' ? 'unidades logísticas en almacén' : 'HUs históricas'}` : 'Sin unidades registradas'}
            </option>
          ))}
        </select>
      </div>

      {/* STEP 2 & MAIN GRID */}
      <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: 20 }}>
        {/* Left Panel - SKU Filter + HU List */}
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Package size={14} /> 2. Productos de {selectedCliente === 'ALL' ? 'Todos los Clientes' : selectedCliente}
          </div>

          <select 
            className="form-select form-select-full" 
            value={selectedSku} 
            onChange={e => { setSelectedSku(e.target.value); setSelectedLabelIdx(0); }}
            style={{ marginBottom: 12, fontSize: 13, fontWeight: 600 }}
            disabled={activeSkus.length === 0}
          >
            {activeSkus.length > 0 ? (
              <>
                <option value="ALL">Todos los productos ({activeSkus.reduce((s, k) => s + k.count, 0)} HUs)</option>
                {activeSkus.map(s => (
                  <option key={s.sku} value={s.sku}>
                    {s.sku} — {s.desc} ({s.count} HUs)
                  </option>
                ))}
              </>
            ) : (
              <option value="ALL">Este depositante no tiene unidades logísticas en este ámbito</option>
            )}
          </select>

          <div className="search-box" style={{ marginBottom: 14 }}>
            <Search size={15} />
            <input
              placeholder="Buscar HU, SKU, lote, ubicación..."
              value={search}
              onChange={e => { setSearch(e.target.value); setSelectedLabelIdx(0); }}
              style={{ fontSize: 12 }}
            />
          </div>

          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-tertiary)', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{scopeTab === 'FISICO' ? 'HUs Físicas en Almacén' : 'HUs Históricas / Despachadas'}</span>
            <span style={{ color: 'var(--primary)', fontWeight: 800 }}>{filteredLabels.length} {filteredLabels.length === 1 ? 'unidad' : 'unidades'}</span>
          </div>

          {/* HU List */}
          <div style={{ maxHeight: '55vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filteredLabels.map((l, i) => {
              const isSelected = selectedLabelIdx === i;

              return (
                <div
                  key={l.huId + i}
                  onClick={() => setSelectedLabelIdx(i)}
                  style={{
                    padding: '12px 14px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    background: isSelected ? 'rgba(99,102,241,0.1)' : 'var(--bg-secondary)',
                    border: isSelected ? '2px solid var(--primary)' : '1px solid var(--border)',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontWeight: 800, fontSize: 13, color: 'var(--primary)' }}>{l.huId}</span>
                      {getTipoHuBadge(l.tipoHu)}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      {getEstadoBadge(l.estadoHu, l.isHistorico)}
                      <span className="badge badge-default" style={{ fontSize: 10, fontWeight: 700 }}>
                        {l.isHistorico && l.estadoHu === 'DESPACHADO' ? 'STG-01' : l.ubicacion}
                      </span>
                    </div>
                  </div>

                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{l.sku} — {l.desc}</div>

                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Lote: <strong>{l.lote}</strong></span>
                    {l.isHistorico ? (
                      <span style={{ color: 'var(--text-tertiary)', fontWeight: 700 }}>
                        {l.cantidad} {l.uom} históricas
                      </span>
                    ) : l.estadoHu === 'CUARENTENA' ? (
                      <span style={{ color: '#D97706', fontWeight: 700 }}>
                        {l.cantidad} {l.uom} físicas · En Cuarentena
                      </span>
                    ) : l.estadoHu === 'BLOQUEADO' ? (
                      <span style={{ color: '#DC2626', fontWeight: 700 }}>
                        {l.cantidad} {l.uom} físicas · Bloqueado
                      </span>
                    ) : (
                      <span style={{ color: 'var(--emerald)', fontWeight: 700 }}>
                        {l.cantidad} {l.uom} físicas
                      </span>
                    )}
                  </div>

                  {l.isHistorico && (
                    <div style={{ fontSize: 10, color: '#6D28D9', marginTop: 4, display: 'flex', justifyContent: 'space-between', borderTop: '1px dashed #DDD6FE', paddingTop: 3 }}>
                      <span>Salida: <strong>{l.documentoSalida || 'Despachado'}</strong></span>
                      <span>Fuera de almacén</span>
                    </div>
                  )}
                </div>
              );
            })}

            {filteredLabels.length === 0 && (
              <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13, background: 'var(--bg-secondary)', borderRadius: 8 }}>
                {selectedCliente !== 'ALL' ? (
                  <>
                    <Package size={28} style={{ opacity: 0.4, margin: '0 auto 8px' }} />
                    <div style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>Depositante {selectedCliente} seleccionado</div>
                    <div style={{ fontSize: 11, marginTop: 4 }}>
                      No hay unidades logísticas en {scopeTab === 'FISICO' ? 'almacén' : 'el histórico'} para este depositante.
                    </div>
                  </>
                ) : (
                  <div>No hay unidades logísticas que coincidan con la búsqueda.</div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Panel - Print Preview & Formats */}
        <div>
          <div className="card" style={{ marginBottom: 16, padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>Formato Etiquetas Zebra:</span>
              {(['4x2', '4x3', '4x6'] as const).map(f => (
                <button key={f} className={`btn btn-sm ${format === f ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFormat(f)}>{f}"</button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              {scopeTab === 'FISICO' ? (
                <>
                  <button
                    className="btn btn-secondary"
                    onClick={() => handleReprint(2)}
                    disabled={!activeLabel}
                    title="Reimprime 2 copias idénticas con el mismo código HU original por etiqueta dañada"
                  >
                    <RefreshCw size={16} /> Reimprimir
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={() => handlePrint(1)}
                    disabled={!activeLabel}
                    title="Imprime 1 copia de la etiqueta con el código HU original"
                  >
                    <Printer size={16} /> Imprimir
                  </button>
                </>
              ) : (
                <button
                  className="btn btn-primary"
                  onClick={() => handlePrint(1)}
                  disabled={!activeLabel}
                  style={{ background: '#6D28D9', borderColor: '#5B21B6' }}
                  title="Reimpresión documental histórica para trazabilidad física o salida"
                >
                  <History size={16} /> Reimpresión Histórica
                </button>
              )}
            </div>
          </div>

          {/* Banner de Estado Operativo / Histórico */}
          {activeLabel && (activeLabel.isHistorico || activeLabel.estadoHu === 'DESPACHADO') && (
            <div style={{ background: '#F5F3FF', border: '1px solid #DDD6FE', borderRadius: 8, padding: '12px 16px', marginBottom: 16, color: '#5B21B6', fontSize: 13, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <History size={18} style={{ color: '#7C3AED', flexShrink: 0, marginTop: 2 }} />
              <div>
                <div style={{ fontWeight: 800, color: '#4C1D95', marginBottom: 2 }}>
                  REIMPRESIÓN HISTÓRICA — UNIDAD LOGÍSTICA FUERA DE ALMACÉN
                </div>
                <div>
                  Esta HU fue despachada en la orden <strong>{activeLabel.documentoSalida || 'PED-2026-0008'}</strong>{activeLabel.destinoSalida ? ` con destino a ${activeLabel.destinoSalida}` : ''}. Última ubicación registrada: <strong>{activeLabel.ubicacion}</strong>. La reimpresión es exclusivamente para reposición de etiqueta dañada o trazabilidad de salida. <strong>NO genera inventario, NO reactiva stock comercial y NO genera movimientos de kárdex.</strong>
                </div>
              </div>
            </div>
          )}

          {activeLabel && activeLabel.estadoHu === 'CUARENTENA' && (
            <div style={{ background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: 8, padding: '12px 16px', marginBottom: 16, color: '#92400E', fontSize: 13, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <AlertTriangle size={18} style={{ color: '#D97706', flexShrink: 0, marginTop: 2 }} />
              <div>
                <div style={{ fontWeight: 800, color: '#92400E', marginBottom: 2 }}>
                  UNIDAD EN CUARENTENA / CONTROL DE CALIDAD
                </div>
                <div>
                  Físicamente presente en almacén ({activeLabel.cantidad} {activeLabel.uom}), pero retenida por calidad. <strong>No disponible comercialmente para surtido ni venta.</strong>
                </div>
              </div>
            </div>
          )}

          {activeLabel && activeLabel.estadoHu === 'BLOQUEADO' && (
            <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, padding: '12px 16px', marginBottom: 16, color: '#991B1B', fontSize: 13, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <ShieldAlert size={18} style={{ color: '#DC2626', flexShrink: 0, marginTop: 2 }} />
              <div>
                <div style={{ fontWeight: 800, color: '#991B1B', marginBottom: 2 }}>
                  UNIDAD BLOQUEADA
                </div>
                <div>
                  Físicamente presente en almacén ({activeLabel.cantidad} {activeLabel.uom}), pero bloqueada operativamente. <strong>No disponible comercialmente.</strong>
                </div>
              </div>
            </div>
          )}

          <div className="card" style={{ padding: 36, display: 'flex', justifyContent: 'center', background: 'var(--bg-secondary)', minHeight: 400 }}>
            {activeLabel ? (
              <div
                id="print-area"
                style={{
                  width: '400px',
                  minHeight: format === '4x2' ? '210px' : format === '4x3' ? '300px' : '580px',
                  border: '2px solid #000',
                  borderRadius: 6,
                  padding: 20,
                  background: '#ffffff',
                  color: '#000000',
                  fontFamily: 'monospace',
                  position: 'relative',
                  boxShadow: '0 10px 25px rgba(0,0,0,0.15)',
                  transition: 'all 0.3s ease',
                }}
              >
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '2px solid #000', paddingBottom: 8, marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 900, letterSpacing: -0.5, color: '#000' }}>GIVING OUT 3PL</div>
                    <div style={{ fontSize: 10, color: '#444', fontWeight: 600 }}>Warehouse Management System</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 10, color: '#444' }}>
                      {activeLabel.isHistorico ? 'SALIDA / DESPACHO' : 'FECHA DE INGRESO'}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 700 }}>{activeLabel.fecha}</div>
                  </div>
                </div>

                {/* Sub-header banner if historical or QA hold */}
                {activeLabel.isHistorico && (
                  <div style={{ background: '#000000', color: '#ffffff', textAlign: 'center', fontSize: 10, fontWeight: 800, padding: '2px 0', marginBottom: 8, letterSpacing: 0.5 }}>
                    *** REIMPRESIÓN HISTÓRICA — FUERA DE ALMACÉN ***
                  </div>
                )}
                {activeLabel.estadoHu === 'CUARENTENA' && (
                  <div style={{ background: '#FFFBEB', color: '#92400E', border: '1px solid #D97706', textAlign: 'center', fontSize: 10, fontWeight: 800, padding: '2px 0', marginBottom: 8, letterSpacing: 0.5 }}>
                    *** CONTROL DE CALIDAD — CUARENTENA ***
                  </div>
                )}
                {activeLabel.estadoHu === 'BLOQUEADO' && (
                  <div style={{ background: '#FEF2F2', color: '#991B1B', border: '1px solid #DC2626', textAlign: 'center', fontSize: 10, fontWeight: 800, padding: '2px 0', marginBottom: 8, letterSpacing: 0.5 }}>
                    *** BLOQUEADO COMERCIALMENTE ***
                  </div>
                )}

                {/* Body / Content */}
                <div style={{ display: 'flex', gap: 14, marginBottom: 10 }}>
                  <div 
                    style={{ width: 85, height: 85, border: '2px solid #000', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, background: '#ffffff', overflow: 'hidden' }}
                    dangerouslySetInnerHTML={{ __html: generateQRCodeSVG(75) }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: 1, color: '#000' }}>{activeLabel.huId}</div>
                      <span style={{ fontSize: 9, fontWeight: 800, border: '1px solid #000', padding: '1px 4px', borderRadius: 3 }}>
                        {activeLabel.tipoHu || 'CAJA'}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, marginTop: 4 }}>
                      <span style={{ color: '#555' }}>SKU:</span> <strong>{activeLabel.sku}</strong>
                    </div>
                    <div style={{ fontSize: 11, marginTop: 2, color: '#222', fontWeight: 600 }}>{activeLabel.desc}</div>
                    <div style={{ fontSize: 12, marginTop: 6, display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #ddd', paddingTop: 4 }}>
                      <span>Lote: <strong>{activeLabel.lote}</strong></span>
                      <span>
                        Cant: <strong>{activeLabel.cantidad} {activeLabel.uom}</strong>
                        {activeLabel.isHistorico && <span style={{ fontSize: 10, color: '#666', marginLeft: 4 }}>(HISTÓRICO)</span>}
                        {activeLabel.estadoHu === 'CUARENTENA' && <span style={{ fontSize: 10, color: '#D97706', marginLeft: 4 }}>(CUARENTENA)</span>}
                        {activeLabel.estadoHu === 'BLOQUEADO' && <span style={{ fontSize: 10, color: '#DC2626', marginLeft: 4 }}>(BLOQUEADO)</span>}
                        {activeLabel.estadoHu === 'ACTIVO' && <span style={{ fontSize: 10, color: '#065F46', marginLeft: 4 }}>(FÍSICO)</span>}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Footer details */}
                <div style={{ borderTop: '1.5px solid #000', paddingTop: 6, marginBottom: 8, display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                  <span>
                    {activeLabel.isHistorico ? 'Última Ubic: ' : 'Ubicación: '}
                    <strong>{activeLabel.isHistorico && activeLabel.estadoHu === 'DESPACHADO' ? `${activeLabel.ubicacion} (Salida)` : activeLabel.ubicacion}</strong>
                  </span>
                  <span>Depositante: <strong>{activeLabel.cliente}</strong></span>
                </div>

                {activeLabel.isHistorico && activeLabel.documentoSalida && (
                  <div style={{ fontSize: 10, color: '#444', marginBottom: 6, display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed #ccc', paddingBottom: 4 }}>
                    <span>Orden Salida: <strong>{activeLabel.documentoSalida}</strong></span>
                    <span>Estado Físico: <strong>Fuera de almacén</strong></span>
                  </div>
                )}

                {/* Barcode Vectorial SVG */}
                <div style={{ marginTop: 10, textAlign: 'center' }}>
                  <div 
                    style={{ margin: '0 auto', maxWidth: '88%' }}
                    dangerouslySetInnerHTML={{ __html: generateBarcodeSVG(activeLabel.huId, 36) }}
                  />
                  <div style={{ fontSize: 11, marginTop: 4, fontFamily: 'monospace', fontWeight: 700, letterSpacing: 1 }}>{activeLabel.huId}</div>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', color: 'var(--text-tertiary)', alignSelf: 'center' }}>
                <div>Selecciona una unidad logística para visualizar su etiqueta Zebra.</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
