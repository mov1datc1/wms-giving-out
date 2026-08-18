import React, { useState, useEffect, useRef } from 'react';
import {
  Printer, X, Tag, Package, Layers, QrCode, Check,
  Sliders, Copy, Download, RefreshCw, Sparkles, CheckCircle2, Box
} from 'lucide-react';
import JsBarcode from 'jsbarcode';

export interface PrintLineItem {
  id: string;
  skuId: string;
  sku: {
    id: string;
    codigo: string;
    descripcion: string;
    categoria?: string;
    subcategoria?: string;
    talla?: string;
    color?: string;
    marca?: string;
    codigoBarras?: string;
    uomBase?: string;
    capacidadEmpaque?: number;
  };
  cantidadEsperada: number;
  printQuantity: number;
  selected: boolean;
}

interface ReceiptPrintModalProps {
  receipt: any;
  onClose: () => void;
  token?: string;
}

export function ReceiptPrintModal({ receipt, onClose, token }: ReceiptPrintModalProps) {
  const [printMode, setPrintMode] = useState<'PIECE' | 'BOX' | 'PALLET'>('PIECE');
  const [labelFormat, setLabelFormat] = useState<'50x25' | '100x50' | 'A4_SHEET'>('50x25');
  const [lines, setLines] = useState<PrintLineItem[]>([]);
  const [previewIndex, setPreviewIndex] = useState<number>(0);
  const [isPrinting, setIsPrinting] = useState(false);
  const previewSvgRef = useRef<SVGSVGElement>(null);

  // Inicializar líneas con cantidad por defecto
  useEffect(() => {
    if (!receipt || !receipt.lineas) return;
    const initialLines: PrintLineItem[] = receipt.lineas.map((l: any) => ({
      id: l.id,
      skuId: l.skuId,
      sku: l.sku || { codigo: 'SKU', descripcion: 'Producto', codigoBarras: '' },
      cantidadEsperada: l.cantidadEsperada || 1,
      // Por defecto en modo PIECE: cantidad esperada; en BOX: 1 por caja; en PALLET: 1
      printQuantity: l.cantidadEsperada || 1,
      selected: true,
    }));
    setLines(initialLines);
  }, [receipt]);

  // Actualizar cantidades al cambiar modo
  function handleModeChange(mode: 'PIECE' | 'BOX' | 'PALLET') {
    setPrintMode(mode);
    setLines(prev => prev.map(l => {
      let qty = 1;
      if (mode === 'PIECE') {
        qty = l.cantidadEsperada;
      } else if (mode === 'BOX') {
        const packSize = l.sku.capacidadEmpaque || 12;
        qty = Math.ceil(l.cantidadEsperada / packSize);
      } else if (mode === 'PALLET') {
        qty = 1;
      }
      return { ...l, printQuantity: Math.max(1, qty) };
    }));

    // Auto-ajustar formato recomendado según el modo
    if (mode === 'PIECE') setLabelFormat('50x25');
    else setLabelFormat('100x50');
  }

  // Renderizar código de barras en el preview SVG
  const currentPreviewItem = lines[previewIndex] || lines[0];

  useEffect(() => {
    if (previewSvgRef.current && currentPreviewItem) {
      const barcodeValue = currentPreviewItem.sku?.codigoBarras || currentPreviewItem.sku?.codigo || '000000000000';
      try {
        // Intentar EAN-13 si tiene 13 dígitos o CODE128 para alfanuméricos
        const isEan13 = /^\d{13}$/.test(barcodeValue);
        JsBarcode(previewSvgRef.current, barcodeValue, {
          format: isEan13 ? 'EAN13' : 'CODE128',
          width: labelFormat === '50x25' ? 1.4 : 1.8,
          height: labelFormat === '50x25' ? 32 : 48,
          displayValue: true,
          fontSize: labelFormat === '50x25' ? 10 : 12,
          margin: 4,
          background: '#ffffff',
          lineColor: '#000000'
        });
      } catch (err) {
        // Fallback a CODE128
        try {
          JsBarcode(previewSvgRef.current, barcodeValue, {
            format: 'CODE128',
            width: 1.4,
            height: 35,
            displayValue: true,
            fontSize: 10,
            margin: 4
          });
        } catch (e) {
          console.error('Error rendering barcode:', e);
        }
      }
    }
  }, [currentPreviewItem, labelFormat]);

  // Conteo total de etiquetas seleccionadas
  const totalLabels = lines.filter(l => l.selected).reduce((acc, l) => acc + (l.printQuantity || 0), 0);

  // Ejecutar impresión directa
  function handlePrint() {
    setIsPrinting(true);

    const selectedLines = lines.filter(l => l.selected && l.printQuantity > 0);
    if (selectedLines.length === 0) {
      alert('Selecciona al menos una línea para imprimir');
      setIsPrinting(false);
      return;
    }

    // Crear ventana de impresión limpia
    const printWindow = window.open('', '_blank', 'width=800,height=600');
    if (!printWindow) {
      alert('Permite las ventanas emergentes en tu navegador para imprimir etiquetas');
      setIsPrinting(false);
      return;
    }

    // Construir HTML de etiquetas
    let labelsHtml = '';
    selectedLines.forEach(item => {
      const barcodeValue = item.sku.codigoBarras || item.sku.codigo;
      const skuCode = item.sku.codigo;
      const skuDesc = item.sku.descripcion;
      const clientName = receipt.cliente?.nombreComercial || 'GIVING OUT';
      const factura = receipt.ocReferencia || receipt.codigo;
      const talla = item.sku.talla ? `Talla: ${item.sku.talla}` : '';
      const color = item.sku.color ? `Color: ${item.sku.color}` : '';
      const extras = [talla, color].filter(Boolean).join(' | ');

      for (let i = 0; i < item.printQuantity; i++) {
        if (labelFormat === '50x25') {
          labelsHtml += `
            <div class="label label-50x25">
              <div class="label-client">${clientName}</div>
              <div class="label-title">${skuDesc}</div>
              <div class="label-sku">SKU: <strong>${skuCode}</strong> ${extras ? `(${extras})` : ''}</div>
              <div class="label-barcode-box">
                <svg class="barcode-svg" data-code="${barcodeValue}"></svg>
              </div>
              <div class="label-footer">
                <span>Doc: ${factura}</span>
                <span>Pza ${i + 1}/${item.printQuantity}</span>
              </div>
            </div>
          `;
        } else {
          // 100x50 o Caja/Pallet
          labelsHtml += `
            <div class="label label-100x50">
              <div class="header-row">
                <div class="company-logo">GIVING OUT 3PL</div>
                <div class="doc-info">${clientName} • Doc: ${factura}</div>
              </div>
              <div class="product-title">${skuDesc}</div>
              <div class="product-meta">
                <span>SKU: <strong>${skuCode}</strong></span>
                <span>${extras}</span>
                <span>${printMode === 'BOX' ? `Caja de ${item.sku.capacidadEmpaque || 12} Pzas` : `Cant: ${item.cantidadEsperada} ${item.sku.uomBase || 'PZA'}`}</span>
              </div>
              <div class="barcode-container">
                <svg class="barcode-svg" data-code="${barcodeValue}"></svg>
              </div>
              <div class="label-footer-row">
                <span>Previo: ${receipt.codigo}</span>
                <span>Etiqueta ${i + 1} de ${item.printQuantity}</span>
                <span>${new Date().toLocaleDateString('es-MX')}</span>
              </div>
            </div>
          `;
        }
      }
    });

    const is50x25 = labelFormat === '50x25';

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Etiquetas — ${receipt.codigo}</title>
          <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"></script>
          <style>
            @page {
              size: ${is50x25 ? '50mm 25mm' : '100mm 50mm'};
              margin: 0;
            }
            body {
              margin: 0;
              padding: 0;
              background: #fff;
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
              color: #000;
              -webkit-print-color-adjust: exact;
            }
            .label {
              page-break-after: always;
              box-sizing: border-box;
              display: flex;
              flex-direction: column;
              justify-content: space-between;
              overflow: hidden;
            }
            .label-50x25 {
              width: 50mm;
              height: 25mm;
              padding: 1.5mm 2mm;
              font-size: 7pt;
              line-height: 1.1;
            }
            .label-50x25 .label-client {
              font-size: 6pt;
              font-weight: 800;
              text-transform: uppercase;
              letter-spacing: 0.5px;
              color: #333;
            }
            .label-50x25 .label-title {
              font-size: 7.5pt;
              font-weight: 700;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            }
            .label-50x25 .label-sku {
              font-size: 6.5pt;
              color: #222;
            }
            .label-50x25 .label-barcode-box {
              text-align: center;
              margin: 0 auto;
            }
            .label-50x25 .label-barcode-box svg {
              max-width: 46mm;
              height: 11mm !important;
            }
            .label-50x25 .label-footer {
              display: flex;
              justify-content: space-between;
              font-size: 5.5pt;
              color: #555;
              border-top: 0.5px solid #ddd;
              padding-top: 1px;
            }

            /* 100x50 */
            .label-100x50 {
              width: 100mm;
              height: 50mm;
              padding: 3mm 4mm;
              font-size: 9pt;
              line-height: 1.2;
            }
            .label-100x50 .header-row {
              display: flex;
              justify-content: space-between;
              align-items: center;
              border-bottom: 1px solid #000;
              padding-bottom: 2px;
            }
            .label-100x50 .company-logo {
              font-weight: 900;
              font-size: 9pt;
              letter-spacing: 1px;
            }
            .label-100x50 .doc-info {
              font-size: 7.5pt;
              font-weight: 600;
            }
            .label-100x50 .product-title {
              font-size: 11pt;
              font-weight: 800;
              margin-top: 2px;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            }
            .label-100x50 .product-meta {
              display: flex;
              gap: 12px;
              font-size: 8.5pt;
              margin: 2px 0;
            }
            .label-100x50 .barcode-container {
              text-align: center;
              margin: 2px 0;
            }
            .label-100x50 .barcode-container svg {
              max-width: 90mm;
              height: 22mm !important;
            }
            .label-100x50 .label-footer-row {
              display: flex;
              justify-content: space-between;
              font-size: 7pt;
              color: #333;
              border-top: 1px solid #ccc;
              padding-top: 2px;
            }
          </style>
        </head>
        <body>
          ${labelsHtml}
          <script>
            document.querySelectorAll('.barcode-svg').forEach(function(el) {
              var code = el.getAttribute('data-code') || '000000';
              try {
                var isEan13 = /^\\d{13}$/.test(code);
                JsBarcode(el, code, {
                  format: isEan13 ? 'EAN13' : 'CODE128',
                  width: ${is50x25 ? 1.4 : 2},
                  height: ${is50x25 ? 30 : 50},
                  displayValue: true,
                  fontSize: ${is50x25 ? 9 : 12},
                  margin: 2
                });
              } catch(e) {
                JsBarcode(el, code, { format: 'CODE128', width: 1.4, height: 30, displayValue: true });
              }
            });
            window.onload = function() {
              window.print();
            };
          </script>
        </body>
      </html>
    `);

    printWindow.document.close();
    setIsPrinting(false);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: 840, maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}
      >
        {/* MODAL HEADER */}
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 8,
              background: 'rgba(37,99,235,0.1)', color: 'var(--primary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <Printer size={20} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: 16 }}>Imprimir Etiquetas de Recepción</h2>
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                Previo: <strong>{receipt.codigo}</strong> • Depositante: <strong>{receipt.cliente?.nombreComercial}</strong>
                {receipt.ocReferencia && ` • Factura: ${receipt.ocReferencia}`}
              </span>
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}><X size={18} /></button>
        </div>

        {/* MODAL BODY */}
        <div className="modal-body" style={{ overflowY: 'auto', flex: 1, padding: 20 }}>
          
          {/* BARRA DE CONFIGURACIÓN DE IMPRESIÓN */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 16, marginBottom: 18 }}>
            
            {/* TIPO DE ETIQUETA / MODO */}
            <div style={{ background: 'var(--bg-secondary)', padding: 14, borderRadius: 8, border: '1px solid var(--border)' }}>
              <label className="form-label" style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Tag size={14} /> TIPO DE ETIQUETA
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                {[
                  { id: 'PIECE', label: 'Por Pieza', icon: Tag, desc: '1 por prenda/unidad' },
                  { id: 'BOX', label: 'Por Caja', icon: Box, desc: '1 por empaque/caja' },
                  { id: 'PALLET', label: 'Por Pallet', icon: Layers, desc: '1 por tarima' },
                ].map(m => {
                  const Icon = m.icon;
                  const isSelected = printMode === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => handleModeChange(m.id as any)}
                      style={{
                        padding: '8px 6px',
                        borderRadius: 6,
                        border: isSelected ? '2px solid var(--primary)' : '1px solid var(--border)',
                        background: isSelected ? 'rgba(37,99,235,0.08)' : 'var(--bg-card)',
                        color: isSelected ? 'var(--primary)' : 'var(--text-secondary)',
                        cursor: 'pointer',
                        textAlign: 'center',
                        transition: 'all 0.15s'
                      }}
                    >
                      <Icon size={16} style={{ margin: '0 auto 4px' }} />
                      <div style={{ fontSize: 12, fontWeight: 700 }}>{m.label}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{m.desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* FORMATO DE PAPEL / IMPRESORA */}
            <div style={{ background: 'var(--bg-secondary)', padding: 14, borderRadius: 8, border: '1px solid var(--border)' }}>
              <label className="form-label" style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Sliders size={14} /> TAMAÑO DE ETIQUETA
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {[
                  { id: '50x25', label: '50 x 25 mm', desc: 'Térmica (Prendas / Ropa)' },
                  { id: '100x50', label: '100 x 50 mm', desc: 'Térmica (Cajas / 4x2")' },
                ].map(f => {
                  const isSelected = labelFormat === f.id;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setLabelFormat(f.id as any)}
                      style={{
                        padding: '10px 8px',
                        borderRadius: 6,
                        border: isSelected ? '2px solid var(--primary)' : '1px solid var(--border)',
                        background: isSelected ? 'rgba(37,99,235,0.08)' : 'var(--bg-card)',
                        color: isSelected ? 'var(--primary)' : 'var(--text-secondary)',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'all 0.15s'
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 700 }}>{f.label}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{f.desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* VISTA PREVIA VISUAL EN VIVO */}
          {currentPreviewItem && (
            <div style={{
              background: 'var(--bg-secondary)',
              padding: 16,
              borderRadius: 8,
              border: '1px solid var(--border)',
              marginBottom: 18
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Sparkles size={14} style={{ color: 'var(--primary)' }} /> Vista Previa de Etiqueta Térmica ({labelFormat} mm)
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                  Producto: <strong>{currentPreviewItem.sku.codigo}</strong>
                </span>
              </div>

              {/* CARD DE ETIQUETA SIMULADA */}
              <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0' }}>
                <div style={{
                  width: labelFormat === '50x25' ? '280px' : '380px',
                  background: '#ffffff',
                  color: '#000000',
                  padding: labelFormat === '50x25' ? '10px 12px' : '14px 16px',
                  borderRadius: 6,
                  border: '2px solid #333',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                  fontFamily: 'monospace'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, borderBottom: '1px solid #ccc', paddingBottom: 4, marginBottom: 4 }}>
                    <span style={{ fontWeight: 800 }}>{receipt.cliente?.nombreComercial || 'GIVING OUT'}</span>
                    <span>{receipt.ocReferencia || receipt.codigo}</span>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {currentPreviewItem.sku.descripcion}
                  </div>
                  <div style={{ fontSize: 11, color: '#333', margin: '2px 0' }}>
                    SKU: <strong>{currentPreviewItem.sku.codigo}</strong>
                    {currentPreviewItem.sku.talla && ` | Talla: ${currentPreviewItem.sku.talla}`}
                    {currentPreviewItem.sku.color && ` | ${currentPreviewItem.sku.color}`}
                  </div>
                  <div style={{ textAlign: 'center', margin: '4px 0' }}>
                    <svg ref={previewSvgRef} style={{ maxWidth: '100%' }}></svg>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#666', borderTop: '1px solid #ddd', paddingTop: 2 }}>
                    <span>EAN: {currentPreviewItem.sku.codigoBarras || currentPreviewItem.sku.codigo}</span>
                    <span>Cant: {currentPreviewItem.cantidadEsperada} uds</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TABLA DE LÍNEAS PARA AJUSTE DE CANTIDADES */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h4 style={{ margin: 0, fontSize: 14 }}>Productos a Imprimir en este Previo</h4>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ fontSize: 11 }}
                  onClick={() => setLines(prev => prev.map(l => ({ ...l, selected: true })))}
                >
                  Seleccionar Todo
                </button>
                <span className="badge badge-info" style={{ fontSize: 12, fontWeight: 700 }}>
                  Total: {totalLabels} etiquetas
                </span>
              </div>
            </div>

            <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
              <table className="data-table" style={{ fontSize: 12, margin: 0 }}>
                <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-secondary)', zIndex: 1 }}>
                  <tr>
                    <th style={{ width: 40, textAlign: 'center' }}></th>
                    <th>SKU / PRODUCTO</th>
                    <th>CÓDIGO EAN-13</th>
                    <th style={{ textAlign: 'right' }}>ESPERADO</th>
                    <th style={{ textAlign: 'center', width: 140 }}>ETIQUETAS A IMPRIMIR</th>
                    <th style={{ width: 60, textAlign: 'center' }}>VER</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((item, idx) => (
                    <tr
                      key={item.id}
                      style={{ background: previewIndex === idx ? 'rgba(37,99,235,0.05)' : undefined }}
                    >
                      <td style={{ textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={item.selected}
                          onChange={e => {
                            const checked = e.target.checked;
                            setLines(prev => prev.map((l, i) => i === idx ? { ...l, selected: checked } : l));
                          }}
                        />
                      </td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{item.sku.codigo}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{item.sku.descripcion}</div>
                      </td>
                      <td style={{ fontFamily: 'monospace', fontWeight: 600, color: item.sku.codigoBarras ? 'var(--primary)' : 'var(--orange)' }}>
                        {item.sku.codigoBarras || (
                          <span style={{ fontSize: 11, color: 'var(--orange)' }}>⚠️ Sin EAN</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{item.cantidadEsperada}</td>
                      <td style={{ textAlign: 'center' }}>
                        <input
                          type="number"
                          min="0"
                          className="form-input"
                          style={{ width: 80, padding: '3px 6px', textAlign: 'center', margin: '0 auto', fontSize: 12 }}
                          value={item.printQuantity}
                          onChange={e => {
                            const val = parseInt(e.target.value) || 0;
                            setLines(prev => prev.map((l, i) => i === idx ? { ...l, printQuantity: val } : l));
                          }}
                        />
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <button
                          type="button"
                          className={`btn btn-sm ${previewIndex === idx ? 'btn-primary' : 'btn-ghost'}`}
                          style={{ padding: '2px 8px', fontSize: 11 }}
                          onClick={() => setPreviewIndex(idx)}
                        >
                          Ver
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* MODAL FOOTER */}
        <div className="modal-footer" style={{ padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
            💡 Las etiquetas se formatearán automáticamente para tu impresora térmica (Zebra, Brother o estándar).
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cerrar</button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handlePrint}
              disabled={isPrinting || totalLabels === 0}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px' }}
            >
              <Printer size={16} />
              {isPrinting ? 'Preparando...' : `Imprimir ${totalLabels} Etiquetas`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
