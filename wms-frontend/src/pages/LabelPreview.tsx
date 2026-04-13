import { useState, useRef, useEffect } from 'react';
import { Tag, Printer, QrCode, Copy, Settings } from 'lucide-react';

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
}

const mockLabels: LabelData[] = [
  { huId: 'HU-000101', sku: 'CAM-001', desc: 'Camisa Oxford Blanca M', lote: 'LOT-2026-A', cantidad: 120, uom: 'PZA', ubicacion: 'A-01-01', cliente: 'Textil MX', fecha: '2026-04-09' },
  { huId: 'HU-000102', sku: 'PAN-015', desc: 'Pantalón Vestir Negro 32', lote: 'LOT-2026-B', cantidad: 85, uom: 'PZA', ubicacion: 'A-01-02', cliente: 'Textil MX', fecha: '2026-04-09' },
  { huId: 'HU-000103', sku: 'GAL-050', desc: 'Galletas Marías 500g', lote: 'AL-2026-001', cantidad: 200, uom: 'CJA', ubicacion: 'B-02-01', cliente: 'Alimentos Plus', fecha: '2026-04-09' },
];

export function LabelPreview() {
  const [selectedLabel, setSelectedLabel] = useState(0);
  const [format, setFormat] = useState<'4x2' | '4x3' | '4x6'>('4x2');
  const label = mockLabels[selectedLabel];

  return (
    <div className="animate-fade">
      <div className="page-header">
        <h1>Etiquetado</h1>
        <p>Generación y vista previa de etiquetas · QR + Code128 + ZPL</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 'var(--space-4)' }}>
        {/* Left panel - Label list */}
        <div className="glass-card" style={{ padding: 'var(--space-4)' }}>
          <div style={{ fontSize: 'var(--font-sm)', fontWeight: 700, marginBottom: 'var(--space-3)' }}>HUs para Etiquetar</div>
          {mockLabels.map((l, i) => (
            <div
              key={l.huId}
              onClick={() => setSelectedLabel(i)}
              style={{
                padding: 'var(--space-3)',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                marginBottom: 'var(--space-2)',
                background: selectedLabel === i ? 'var(--accent-primary-soft)' : 'transparent',
                border: selectedLabel === i ? '1px solid rgba(13,148,136,0.2)' : '1px solid transparent',
                transition: 'all 0.15s',
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 'var(--font-sm)', color: selectedLabel === i ? 'var(--accent-primary)' : 'var(--text-primary)' }}>{l.huId}</div>
              <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)' }}>{l.sku} · {l.desc}</div>
            </div>
          ))}
        </div>

        {/* Right panel - Preview */}
        <div>
          <div className="filter-bar" style={{ marginBottom: 'var(--space-4)' }}>
            <span style={{ fontSize: 'var(--font-sm)', fontWeight: 600-0, color: 'var(--text-secondary)' }}>Formato:</span>
            {(['4x2', '4x3', '4x6'] as const).map(f => (
              <button key={f} className={`btn btn-sm ${format === f ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFormat(f)}>{f}"</button>
            ))}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--space-2)' }}>
              <button className="btn btn-secondary btn-sm"><Copy size={14} /> Duplicar</button>
              <button className="btn btn-primary btn-sm"><Printer size={14} /> Imprimir</button>
            </div>
          </div>

          <div className="glass-card" style={{ padding: 'var(--space-6)', display: 'flex', justifyContent: 'center' }}>
            {/* Label Preview */}
            <div
              id="print-area"
              style={{
                width: format === '4x2' ? '384px' : format === '4x3' ? '384px' : '384px',
                minHeight: format === '4x2' ? '192px' : format === '4x3' ? '288px' : '576px',
                border: '2px solid var(--text-primary)',
                borderRadius: 4,
                padding: 16,
                background: 'white',
                fontFamily: 'monospace',
                position: 'relative',
              }}
            >
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #333', paddingBottom: 8, marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: -0.5 }}>GIVING OUT</div>
                  <div style={{ fontSize: 9, color: '#666' }}>Warehouse Management</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 10, color: '#666' }}>Fecha</div>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{label.fecha}</div>
                </div>
              </div>

              {/* QR placeholder */}
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ width: 80, height: 80, border: '1px solid #ccc', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, background: '#f9f9f9' }}>
                  <QrCode size={48} color="#333" />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: 1 }}>{label.huId}</div>
                  <div style={{ fontSize: 11, marginTop: 4 }}>
                    <span style={{ color: '#666' }}>SKU:</span> <strong>{label.sku}</strong>
                  </div>
                  <div style={{ fontSize: 10, marginTop: 2, color: '#444' }}>{label.desc}</div>
                  <div style={{ fontSize: 11, marginTop: 4 }}>
                    <span style={{ color: '#666' }}>Lote:</span> <strong>{label.lote}</strong>
                    <span style={{ marginLeft: 12, color: '#666' }}>Cant:</span> <strong>{label.cantidad} {label.uom}</strong>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div style={{ borderTop: '1px solid #333', marginTop: 8, paddingTop: 6, display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
                <span><strong>Ubic:</strong> {label.ubicacion}</span>
                <span><strong>Cliente:</strong> {label.cliente}</span>
              </div>

              {/* Barcode placeholder */}
              <div style={{ marginTop: 8, textAlign: 'center' }}>
                <div style={{ height: 30, background: 'repeating-linear-gradient(90deg, #000 0px, #000 2px, #fff 2px, #fff 4px, #000 4px, #000 5px, #fff 5px, #fff 8px)', margin: '0 auto', maxWidth: '80%' }} />
                <div style={{ fontSize: 9, marginTop: 2, fontFamily: 'monospace' }}>{label.huId}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
