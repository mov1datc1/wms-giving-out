import React, { useState, useEffect, useRef } from 'react';
import { Printer, X, FileText, Share2, Layers, Box, RotateCcw } from 'lucide-react';
import JsBarcode from 'jsbarcode';

export interface ReceiptReportModalProps {
  receipt: any;
  onClose: () => void;
  defaultMode?: 'RECEPCION' | 'DEVOLUCIONES';
}

export function ReceiptReportModal({ receipt, onClose, defaultMode }: ReceiptReportModalProps) {
  if (!receipt) return null;

  // Determinar modo inicial: si tiene merma/daño o se especifica, arrancar en DEVOLUCIONES, sino en RECEPCION
  const hasReturns = Array.isArray(receipt.lineas) && receipt.lineas.some((l: any) => (l.cantidadDanada || 0) > 0 || l.tipo === 'Caja devolucion');
  const initialMode = defaultMode || (receipt.tipoRecepcion === 'DEVOLUCION' || hasReturns ? 'DEVOLUCIONES' : 'RECEPCION');

  const [reportMode, setReportMode] = useState<'RECEPCION' | 'DEVOLUCIONES'>(initialMode);
  const [brandLogo, setBrandLogo] = useState<'PROVA' | 'GIVING_OUT'>('PROVA');
  const [viewTab, setViewTab] = useState<'BULTOS_1TO1' | 'DETALLE_SKU'>('BULTOS_1TO1');

  // Metadatos oficiales 1:1 de transporte
  const folioTransporte = receipt.folioTransporte || receipt.codigoTransporte || receipt.codigo || '23120690080';
  const fechaTransporte = receipt.fechaTransporte || (receipt.fechaRecepcion ? receipt.fechaRecepcion.split('T')[0] : '2023-12-06');
  
  const rawDate = receipt.fechaConfirmacion || receipt.fechaRecepcion || new Date().toISOString();
  const fechaConfirmacion = rawDate.replace('T', ' ').substring(0, 19);

  const lineaTransporte = receipt.lineaTransporte || 'TEMPAQ';
  const capacidadCarga = receipt.capacidadCarga || receipt.tipoUnidad || 'CAMION 3.5 TONELADA';
  const placas = receipt.placa || receipt.placas || '7851ZP';
  const chofer = receipt.nombreChofer || receipt.chofer || 'BRYAN CID ANGELES';
  const cliente = receipt.cliente?.nombreComercial || receipt.cliente?.nombreEmpresa || 'Fashion Forward S.A. de C.V.';
  const factura = receipt.ocReferencia || 'FAC-2026-TEST-001';
  const estado = receipt.estado || 'CONFIRMADO';

  const barcodeSvgRef = useRef<SVGSVGElement>(null);

  // Renderizar código de barras Code-128 dinámico del folio de transporte
  useEffect(() => {
    if (barcodeSvgRef.current) {
      try {
        JsBarcode(barcodeSvgRef.current, folioTransporte, {
          format: 'CODE128',
          width: 1.7,
          height: 46,
          displayValue: true,
          font: 'monospace',
          fontSize: 13,
          textMargin: 3,
          margin: 2,
          lineColor: '#000000',
        });
      } catch (err) {
        console.warn('Error al renderizar código de barras:', err);
      }
    }
  }, [folioTransporte, reportMode, brandLogo, viewTab]);

  // Líneas de muestra oficiales 1:1 para DEVOLUCIONES (exactas al ticket físico)
  const provaDevolucionesDefaultLines = [
    { folio: '18966', sucursal: 'N1050001', tipo: 'Caja devolucion', previo: '-', cajas: 1, diferencia: '-' },
    { folio: '19078', sucursal: 'N1050001', tipo: 'Caja devolucion', previo: '-', cajas: 0, diferencia: '-' },
    { folio: '3375',  sucursal: 'N3040001', tipo: 'Caja devolucion', previo: '-', cajas: 1, diferencia: '-' },
    { folio: '3399',  sucursal: 'N3040001', tipo: 'Caja devolucion', previo: '-', cajas: 1, diferencia: '-' },
    { folio: '11837', sucursal: 'N1210001', tipo: 'Caja devolucion', previo: '-', cajas: 1, diferencia: '-' },
    { folio: '807134', sucursal: 'N3040001', tipo: 'Bandeja azul', previo: 13, cajas: 13, diferencia: 0 },
    { folio: '807101', sucursal: 'N1050001', tipo: 'Bandeja azul', previo: 34, cajas: 34, diferencia: 0 },
    { folio: '807153', sucursal: 'N5640001', tipo: 'Bandeja azul', previo: 22, cajas: 22, diferencia: 0 },
    { folio: '807159', sucursal: 'N1210001', tipo: 'Bandeja azul', previo: 8,  cajas: 8,  diferencia: 0 },
  ];

  // Líneas de muestra oficiales para RECEPCIÓN NORMAL DE MERCANCÍA
  const provaRecepcionDefaultLines = [
    { folio: '807101', sucursal: 'N1050001', tipo: 'Caja máster', previo: 34, cajas: 34, diferencia: 0 },
    { folio: '807102', sucursal: 'N1050001', tipo: 'Caja máster', previo: 40, cajas: 40, diferencia: 0 },
    { folio: '807134', sucursal: 'N3040001', tipo: 'Tarima / Pallet', previo: 12, cajas: 12, diferencia: 0 },
    { folio: '807153', sucursal: 'N5640001', tipo: 'Bandeja azul', previo: 22, cajas: 22, diferencia: 0 },
    { folio: '807159', sucursal: 'N1210001', tipo: 'Bandeja azul', previo: 8,  cajas: 8,  diferencia: 0 },
    { folio: '807210', sucursal: 'N1050001', tipo: 'Caja máster', previo: 15, cajas: 15, diferencia: 0 },
    { folio: '807222', sucursal: 'N3040001', tipo: 'Tarima / Pallet', previo: 6,  cajas: 6,  diferencia: 0 },
  ];

  // Determinar líneas de bultos
  const hasRealLines = Array.isArray(receipt.lineas) && receipt.lineas.length > 0;
  
  const bultoLines = hasRealLines && receipt.lineas.some((l: any) => l.folio || l.tipo)
    ? receipt.lineas.map((l: any, i: number) => {
        const esp = l.cantidadEsperada !== undefined ? l.cantidadEsperada : '-';
        const rec = l.cantidadRecibida !== undefined ? l.cantidadRecibida : (esp !== '-' ? esp : 1);
        const dif = (typeof esp === 'number' && typeof rec === 'number') ? (rec - esp) : '-';
        return {
          folio: l.folio || `807${100 + i}`,
          sucursal: l.sucursal || 'N1050001',
          tipo: l.tipo || (reportMode === 'DEVOLUCIONES' ? (i < 3 ? 'Caja devolucion' : 'Bandeja azul') : 'Caja máster'),
          previo: esp,
          cajas: rec,
          diferencia: dif
        };
      })
    : (reportMode === 'DEVOLUCIONES' ? provaDevolucionesDefaultLines : provaRecepcionDefaultLines);

  // Totales agrupados por tipo para la tabla inferior derecha
  const summaryGrouped: Record<string, { total: number; diferencia: number | string }> = {};
  let grandTotalCajas = 0;

  bultoLines.forEach(l => {
    const t = (l.tipo || 'Caja máster').toUpperCase();
    if (!summaryGrouped[t]) {
      summaryGrouped[t] = { total: 0, diferencia: '-' };
    }
    const cant = typeof l.cajas === 'number' ? l.cajas : parseInt(l.cajas, 10) || 0;
    summaryGrouped[t].total += cant;
    grandTotalCajas += cant;

    if (typeof l.diferencia === 'number') {
      const currentDif = typeof summaryGrouped[t].diferencia === 'number' ? summaryGrouped[t].diferencia : 0;
      summaryGrouped[t].diferencia = (currentDif as number) + l.diferencia;
    }
  });

  // Asegurar que si está en DEVOLUCIONES, aparezca la fila de ARCHIVO si aplica como en la foto
  if (reportMode === 'DEVOLUCIONES' && !summaryGrouped['ARCHIVO']) {
    summaryGrouped['ARCHIVO'] = { total: 0, diferencia: '-' };
  }

  const summaryRows = Object.entries(summaryGrouped).map(([tipo, data]) => ({
    tipo,
    total: data.total,
    diferencia: data.diferencia
  }));

  // Datos para Vista Detallada por SKU
  let totalEsperadoSKU = 0;
  let totalConformeSKU = 0;
  let totalMermaSKU = 0;

  const defaultSkuLines = [
    { codigo: 'CAM-BLA-L', ean: '7509131882811', descripcion: 'Camiseta Básica Blanca L', esperada: 100, conforme: 100, merma: 0 },
    { codigo: 'CAM-NEG-M', ean: '7509805070810', descripcion: 'Camiseta Básica Negra M', lote: 'LOT-2026-01', fechaVencimiento: '-', esperada: 80, conforme: 75, merma: 5 },
    { codigo: 'PAN-JEA-30', ean: '7508266573915', descripcion: 'Pantalón Jeans Clásico 30', lote: 'LOT-2026-02', fechaVencimiento: '-', esperada: 60, conforme: 60, merma: 0 },
    { codigo: 'SUD-DEP-AZU', ean: '7501112223334', descripcion: 'Sudadera Deportiva Unisex Azul L', lote: 'LOT-2026-03', fechaVencimiento: '-', esperada: 200, conforme: 195, merma: 5 },
  ];

  const skuLines = hasRealLines ? receipt.lineas.map((l: any, idx: number) => {
    const esp = Number(l.cantidadEsperada ?? 0);
    const conf = Number(l.cantidadRecibida ?? l.cantidadConforme ?? 0);
    const merm = Number(l.cantidadDanada ?? l.cantidadNoConforme ?? 0);
    totalEsperadoSKU += esp;
    totalConformeSKU += conf;
    totalMermaSKU += merm;
    return {
      codigo: l.sku?.codigo || l.codigo || `SKU-${idx + 1}`,
      ean: l.sku?.codigoBarras || l.codigoBarras || '750' + Math.floor(1000000000 + Math.random() * 9000000000),
      descripcion: l.sku?.descripcion || l.descripcion || 'Producto Confección / Textil',
      lote: l.loteAsignado || l.loteEsperado || l.lote || '-',
      fechaVencimiento: l.fechaVencimiento ? String(l.fechaVencimiento).slice(0, 10) : (l.fechaCaducidadEsperada ? String(l.fechaCaducidadEsperada).slice(0, 10) : '-'),
      esperada: esp,
      conforme: conf,
      merma: merm
    };
  }) : defaultSkuLines;

  if (!hasRealLines) {
    totalEsperadoSKU = 440;
    totalConformeSKU = 430;
    totalMermaSKU = 10;
  }

  // Manejo de Impresión Limpia en ventana aislada
  const handlePrint = () => {
    const printElement = document.getElementById('print-official-prova-receipt');
    if (!printElement) {
      window.print();
      return;
    }

    const printWindow = window.open('', '_blank', 'width=950,height=1000');
    if (!printWindow) {
      window.print();
      return;
    }

    const titleText = reportMode === 'DEVOLUCIONES' ? 'REPORTE DEVOLUCIONES' : 'REPORTE RECEPCIÓN DE MERCANCÍA';

    printWindow.document.write(`
      <!DOCTYPE html>
      <html lang="es">
        <head>
          <meta charset="utf-8" />
          <title>${titleText} — ${folioTransporte}</title>
          <style>
            @page {
              size: letter portrait;
              margin: 12mm 15mm;
            }
            body {
              font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
              margin: 0;
              padding: 0;
              background: #ffffff !important;
              color: #000000 !important;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            * {
              box-sizing: border-box !important;
            }
            table {
              width: 100%;
              border-collapse: collapse;
            }
            th, td {
              border: 1px solid #000000;
            }
          </style>
        </head>
        <body>
          ${printElement.innerHTML}
          <script>
            setTimeout(function() {
              window.print();
              window.close();
            }, 300);
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  // Manejo de Envío por WhatsApp
  const handleShareWhatsApp = () => {
    const isDevolucion = reportMode === 'DEVOLUCIONES';
    const text = `*${isDevolucion ? 'REPORTE DEVOLUCIONES' : 'REPORTE RECEPCIÓN DE MERCANCÍA'} — ${brandLogo === 'PROVA' ? 'PROVA' : 'GIVING OUT WMS 360+'}*
=================================
*FECHA TRANSPORTE:* ${fechaTransporte}
*FOLIO TRANSPORTE:* ${folioTransporte}
*FECHA CONFIRMACIÓN:* ${fechaConfirmacion}
*LÍNEA DE TRANSPORTE:* ${lineaTransporte}
*CAPACIDAD DE CARGA:* ${capacidadCarga}
*PLACAS:* ${placas}
*NOMBRE OPERADOR:* ${chofer}

*RESUMEN DE BULTOS / CONTENEDORES:*
---------------------------------
${summaryRows.map(s => {
  const difTxt = s.diferencia === 0 ? '0' : (typeof s.diferencia === 'number' && s.diferencia > 0) ? `+${s.diferencia}` : s.diferencia;
  return `• *${s.tipo.toUpperCase()}:* ${s.total} u. (Dif: ${difTxt})`;
}).join('\n')}
---------------------------------
*TOTAL GENERAL DE BULTOS:* ${grandTotalCajas}

*ESTATUS:* ${estado} (Confirmado en andén)
=================================`;

    const encoded = encodeURIComponent(text);
    window.open(`https://api.whatsapp.com/send?text=${encoded}`, '_blank');
  };

  return (
    <div className="asn-modal-wrapper" style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      zIndex: 99999,
      backgroundColor: 'rgba(15, 23, 42, 0.85)',
      backdropFilter: 'blur(5px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '16px',
      overflowY: 'auto'
    }}>
      
      {/* Estilos para impresión sin bordes rotos */}
      <style>{`
        @media print {
          @page {
            size: letter portrait;
            margin: 10mm;
          }
          html, body {
            background: #ffffff !important;
            color: #000000 !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: visible !important;
          }
          .asn-modal-no-print {
            display: none !important;
          }
          .asn-modal-wrapper {
            position: static !important;
            background: #ffffff !important;
            padding: 0 !important;
            display: block !important;
            overflow: visible !important;
            backdrop-filter: none !important;
          }
          .asn-printable-card {
            width: 100% !important;
            max-width: 100% !important;
            box-shadow: none !important;
            border: none !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
            color: #000000 !important;
          }
          #print-official-prova-receipt {
            display: block !important;
            width: 100% !important;
            padding: 0 !important;
            margin: 0 !important;
            background: #ffffff !important;
            color: #000000 !important;
          }
        }
      `}</style>

      <div className="asn-printable-card" style={{
        width: '100%',
        maxWidth: '920px',
        maxHeight: '96vh',
        backgroundColor: '#ffffff',
        borderRadius: '16px',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        color: '#0f172a',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
      }}>
        
        {/* ========================================================================= */}
        {/* BARRA SUPERIOR DE CONTROL INTERACTIVO (NO SE IMPRIME)                    */}
        {/* ========================================================================= */}
        <div className="asn-modal-no-print" style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '14px 20px',
          borderBottom: '1px solid #e2e8f0',
          backgroundColor: '#0f172a',
          color: '#f8fafc',
          flexWrap: 'wrap',
          gap: '12px'
        }}>
          
          {/* Lado Izquierdo: Modalidad Oficial Heredada del Previo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8', fontWeight: 700 }}>
              Modalidad Oficial:
            </span>
            {reportMode === 'DEVOLUCIONES' ? (
              <span style={{
                padding: '5px 12px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 800,
                backgroundColor: 'rgba(239, 68, 68, 0.2)',
                color: '#f87171',
                border: '1px solid rgba(239, 68, 68, 0.4)',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}>
                <RotateCcw size={14} /> 🔄 DEVOLUCIÓN (Retorno)
              </span>
            ) : (
              <span style={{
                padding: '5px 12px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 800,
                backgroundColor: 'rgba(16, 185, 129, 0.2)',
                color: '#34d399',
                border: '1px solid rgba(16, 185, 129, 0.4)',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}>
                <Box size={14} /> 📦 RECEPCIÓN NORMAL (Compra)
              </span>
            )}

            {/* Switch de Marca: PROVA vs Giving Out */}
            <div style={{ display: 'flex', backgroundColor: '#1e293b', padding: '3px', borderRadius: '8px', border: '1px solid #334155', marginLeft: '6px' }}>
              <button
                type="button"
                onClick={() => setBrandLogo('PROVA')}
                style={{
                  padding: '5px 10px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontWeight: 800,
                  border: 'none',
                  cursor: 'pointer',
                  backgroundColor: brandLogo === 'PROVA' ? '#ffffff' : 'transparent',
                  color: brandLogo === 'PROVA' ? '#dc2626' : '#94a3b8',
                }}
              >
                Logo PROVA
              </button>
              <button
                type="button"
                onClick={() => setBrandLogo('GIVING_OUT')}
                style={{
                  padding: '5px 10px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontWeight: 800,
                  border: 'none',
                  cursor: 'pointer',
                  backgroundColor: brandLogo === 'GIVING_OUT' ? '#0d9488' : 'transparent',
                  color: brandLogo === 'GIVING_OUT' ? '#ffffff' : '#94a3b8',
                }}
              >
                Logo Giving Out
              </button>
            </div>
          </div>

          {/* Selector de Pestaña de Vista: 1:1 Bultos vs Detalle SKU */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ display: 'flex', backgroundColor: '#1e293b', padding: '3px', borderRadius: '8px', border: '1px solid #334155' }}>
              <button
                type="button"
                onClick={() => setViewTab('BULTOS_1TO1')}
                style={{
                  padding: '5px 12px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 700,
                  border: 'none',
                  cursor: 'pointer',
                  backgroundColor: viewTab === 'BULTOS_1TO1' ? '#334155' : 'transparent',
                  color: viewTab === 'BULTOS_1TO1' ? '#ffffff' : '#94a3b8',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px'
                }}
              >
                <Layers size={13} /> Manifiesto Bultos (1:1 PROVA)
              </button>
              <button
                type="button"
                onClick={() => setViewTab('DETALLE_SKU')}
                style={{
                  padding: '5px 12px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 700,
                  border: 'none',
                  cursor: 'pointer',
                  backgroundColor: viewTab === 'DETALLE_SKU' ? '#334155' : 'transparent',
                  color: viewTab === 'DETALLE_SKU' ? '#ffffff' : '#94a3b8',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px'
                }}
              >
                <FileText size={13} /> Detalle por SKU
              </button>
            </div>

            {/* Acciones: WhatsApp, Imprimir y Cerrar */}
            <button
              type="button"
              onClick={handleShareWhatsApp}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                padding: '7px 14px', borderRadius: '8px',
                backgroundColor: '#25d366', border: 'none',
                color: '#ffffff', fontSize: '12px', fontWeight: 700, cursor: 'pointer',
                boxShadow: '0 2px 6px rgba(37, 211, 102, 0.3)'
              }}
            >
              <Share2 size={15} /> WhatsApp
            </button>

            <button
              type="button"
              onClick={handlePrint}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                padding: '7px 16px', borderRadius: '8px',
                backgroundColor: '#0d9488', border: 'none',
                color: '#ffffff', fontSize: '12px', fontWeight: 700, cursor: 'pointer',
                boxShadow: '0 2px 6px rgba(13, 148, 136, 0.3)'
              }}
            >
              <Printer size={15} /> Imprimir / PDF
            </button>
            
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '6px', borderRadius: '6px', backgroundColor: 'transparent',
                border: 'none', color: '#94a3b8', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}
              title="Cerrar modal"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* CUERPO DEL REPORTE 1:1 (IMPRIMIBLE Y VISUALIZABLE)                       */}
        {/* ========================================================================= */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px', backgroundColor: '#ffffff' }}>
          <div id="print-official-prova-receipt" style={{ maxWidth: '820px', margin: '0 auto' }}>

            {/* --------------------------------------------------------------------- */}
            {/* ENCABEZADO SUPERIOR: METADATOS (IZQUIERDA) Y LOGO + BARCODE (DERECHA) */}
            {/* --------------------------------------------------------------------- */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              marginBottom: '20px'
            }}>
              
              {/* LADO IZQUIERDO: TÍTULO Y METADATOS OFICIALES DE TRANSPORTE */}
              <div style={{ flex: 1, maxWidth: '58%' }}>
                {/* Título Oficial en Negrita Mayúscula */}
                <h1 style={{
                  fontSize: '16px',
                  fontWeight: 900,
                  color: '#000000',
                  margin: '0 0 10px 0',
                  letterSpacing: '0.01em',
                  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
                }}>
                  {reportMode === 'DEVOLUCIONES' ? 'REPORTE DEVOLUCIONES' : 'REPORTE RECEPCIÓN DE MERCANCÍA'}
                </h1>

                {/* Lista de Metadatos 1:1 con Formato Industrial */}
                <div style={{
                  fontSize: '12px',
                  lineHeight: '1.65',
                  color: '#000000',
                  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
                }}>
                  <div>
                    <span style={{ fontWeight: 700 }}>FECHA TRANSPORTE: </span>
                    <span>{fechaTransporte}</span>
                  </div>
                  <div>
                    <span style={{ fontWeight: 700 }}>FOLIO TRANSPORTE: </span>
                    <span>{folioTransporte}</span>
                  </div>
                  <div>
                    <span style={{ fontWeight: 700 }}>FECHA CONFIRMACION: </span>
                    <span>{fechaConfirmacion}</span>
                  </div>
                  <div>
                    <span style={{ fontWeight: 700 }}>LINEA DE TRANSPORTE: </span>
                    <span>{lineaTransporte}</span>
                  </div>
                  <div>
                    <span style={{ fontWeight: 700 }}>CAPACIDAD DE CARGA: </span>
                    <span>{capacidadCarga}</span>
                  </div>
                  <div>
                    <span style={{ fontWeight: 700 }}>PLACAS: </span>
                    <span>{placas}</span>
                  </div>
                  <div>
                    <span style={{ fontWeight: 700 }}>NOMBRE OPERADOR: </span>
                    <span>{chofer}</span>
                  </div>
                </div>
              </div>

              {/* LADO DERECHO: LOGOTIPO CORPORATIVO Y CÓDIGO DE BARRAS 128 */}
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-end',
                textAlign: 'right'
              }}>
                
                {/* LOGO PROVA U OFICIAL GIVING OUT */}
                {brandLogo === 'PROVA' ? (
                  <div style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    border: '1.5px solid #dc2626',
                    borderRadius: '2px',
                    overflow: 'hidden',
                    backgroundColor: '#ffffff',
                    marginBottom: '10px'
                  }}>
                    {/* Icono de flechas rojas PROVA */}
                    <div style={{
                      padding: '4px 6px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRight: '1.5px solid #dc2626',
                      background: '#ffffff'
                    }}>
                      <svg width="30" height="30" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 40L24 16L36 40H28L24 30L20 40H12Z" fill="#DC2626" />
                        <path d="M24 6L6 28H16L24 14L32 28H42L24 6Z" fill="#DC2626" opacity="0.95" />
                      </svg>
                    </div>
                    {/* Logotipo Tipográfico PROVA */}
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <div style={{
                        padding: '2px 14px 0px 14px',
                        fontWeight: 900,
                        fontSize: '22px',
                        letterSpacing: '2px',
                        color: '#000000',
                        lineHeight: 1.1,
                        textAlign: 'center'
                      }}>
                        PROVA
                      </div>
                      <div style={{
                        backgroundColor: '#dc2626',
                        color: '#ffffff',
                        fontSize: '7px',
                        fontWeight: 800,
                        letterSpacing: '0.6px',
                        padding: '2px 6px',
                        textAlign: 'center',
                        textTransform: 'uppercase'
                      }}>
                        PROCESOS DE VALOR AGREGADO
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '6px 12px',
                    border: '1.5px solid #0d9488',
                    borderRadius: '4px',
                    backgroundColor: '#f0fdfa',
                    marginBottom: '10px'
                  }}>
                    <div style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '4px',
                      backgroundColor: '#0d9488',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#ffffff',
                      fontWeight: 900,
                      fontSize: '14px'
                    }}>
                      GO
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', textAlign: 'left' }}>
                      <div style={{ fontWeight: 900, fontSize: '14px', color: '#0f172a', lineHeight: 1.1 }}>
                        GIVING OUT WMS
                      </div>
                      <div style={{ fontSize: '7.5px', fontWeight: 700, color: '#0d9488', letterSpacing: '0.5px' }}>
                        OPERADOR LOGÍSTICO 3PL
                      </div>
                    </div>
                  </div>
                )}

                {/* CÓDIGO DE BARRAS VECTORIAL 1:1 ESCANEABLE CON LASER */}
                <div style={{ textAlign: 'center', minWidth: '220px' }}>
                  <svg ref={barcodeSvgRef} style={{ width: '100%', height: 'auto', display: 'block' }}></svg>
                </div>
              </div>
            </div>

            {/* --------------------------------------------------------------------- */}
            {/* VISTA 1: MANIFIESTO 1:1 PROVA DE BULTOS Y CONTENEDORES                */}
            {/* --------------------------------------------------------------------- */}
            {viewTab === 'BULTOS_1TO1' && (
              <>
                {/* TABLA PRINCIPAL DE BULTOS CON FRANJA DE TÍTULO */}
                <div style={{ marginBottom: '20px' }}>
                  <table style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    border: '1.5px solid #000000',
                    fontSize: '12px',
                    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
                  }}>
                    {/* CABECERA CON EL TÍTULO CENTRAL (DEVOLUCIONES O RECEPCIÓN DE MERCANCÍA) */}
                    <thead>
                      <tr>
                        <th
                          colSpan={6}
                          style={{
                            border: '1.5px solid #000000',
                            padding: '7px',
                            textAlign: 'center',
                            fontSize: '13px',
                            fontWeight: 900,
                            letterSpacing: '0.05em',
                            backgroundColor: '#ffffff',
                            color: '#000000'
                          }}
                        >
                          {reportMode === 'DEVOLUCIONES' ? 'DEVOLUCIONES' : 'RECEPCIÓN DE MERCANCÍA'}
                        </th>
                      </tr>
                      <tr style={{ backgroundColor: '#ffffff', color: '#000000' }}>
                        <th style={{ border: '1px solid #000000', padding: '6px 8px', fontWeight: 800, textAlign: 'center', width: '15%' }}>
                          FOLIO
                        </th>
                        <th style={{ border: '1px solid #000000', padding: '6px 8px', fontWeight: 800, textAlign: 'center', width: '18%' }}>
                          SUCURSAL
                        </th>
                        <th style={{ border: '1px solid #000000', padding: '6px 8px', fontWeight: 800, textAlign: 'center', width: '27%' }}>
                          TIPO
                        </th>
                        <th style={{ border: '1px solid #000000', padding: '6px 8px', fontWeight: 800, textAlign: 'center', width: '13%' }}>
                          PREVIO
                        </th>
                        <th style={{ border: '1px solid #000000', padding: '6px 8px', fontWeight: 800, textAlign: 'center', width: '13%' }}>
                          CAJAS
                        </th>
                        <th style={{ border: '1px solid #000000', padding: '6px 8px', fontWeight: 800, textAlign: 'center', width: '14%' }}>
                          DIFERENCIA
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {bultoLines.map((row, idx) => (
                        <tr key={idx} style={{ backgroundColor: '#ffffff' }}>
                          <td style={{ border: '1px solid #000000', padding: '5px 8px', textAlign: 'center', fontWeight: 600 }}>
                            {row.folio}
                          </td>
                          <td style={{ border: '1px solid #000000', padding: '5px 8px', textAlign: 'center', fontWeight: 500 }}>
                            {row.sucursal}
                          </td>
                          <td style={{ border: '1px solid #000000', padding: '5px 12px', textAlign: 'left', fontWeight: 500 }}>
                            {row.tipo}
                          </td>
                          <td style={{ border: '1px solid #000000', padding: '5px 8px', textAlign: 'center' }}>
                            {row.previo}
                          </td>
                          <td style={{ border: '1px solid #000000', padding: '5px 8px', textAlign: 'center', fontWeight: 700 }}>
                            {row.cajas}
                          </td>
                          <td style={{ border: '1px solid #000000', padding: '5px 8px', textAlign: 'center' }}>
                            {row.diferencia}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* TABLA RESUMEN DE TOTALES AGRUPADA POR TIPO (ALINEADA A LA DERECHA) */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '30px' }}>
                  <table style={{
                    width: '320px',
                    borderCollapse: 'collapse',
                    border: '1.5px solid #000000',
                    fontSize: '12px',
                    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
                  }}>
                    <thead>
                      <tr style={{ backgroundColor: '#ffffff' }}>
                        <th style={{ border: '1px solid #000000', padding: '6px 10px', textAlign: 'center', fontWeight: 800, width: '70%' }}>
                          TOTAL
                        </th>
                        <th style={{ border: '1px solid #000000', padding: '6px 10px', textAlign: 'center', fontWeight: 800, width: '30%' }}>
                          DIFERENCIA
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {summaryRows.map((s, i) => (
                        <tr key={i} style={{ backgroundColor: '#ffffff' }}>
                          <td style={{ border: '1px solid #000000', padding: '5px 10px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontWeight: 600 }}>{s.tipo}</span>
                              <span style={{ fontWeight: 700 }}>{s.total}</span>
                            </div>
                          </td>
                          <td style={{ border: '1px solid #000000', padding: '5px 10px', textAlign: 'center' }}>
                            {s.diferencia}
                          </td>
                        </tr>
                      ))}
                      {/* FILA FINAL TOTAL CONSOLIDADO */}
                      <tr style={{ backgroundColor: '#ffffff', fontWeight: 900 }}>
                        <td style={{ border: '1.5px solid #000000', padding: '6px 10px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>TOTAL</span>
                            <span>{grandTotalCajas}</span>
                          </div>
                        </td>
                        <td style={{ border: '1.5px solid #000000', padding: '6px 10px', textAlign: 'center' }}>
                          -
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {/* --------------------------------------------------------------------- */}
            {/* VISTA 2: AUDITORÍA DETALLADA POR SKU / PRODUCTO                       */}
            {/* --------------------------------------------------------------------- */}
            {viewTab === 'DETALLE_SKU' && (
              <div style={{ marginBottom: '30px' }}>
                <div style={{
                  padding: '10px 14px',
                  backgroundColor: '#f8fafc',
                  border: '1px solid #cbd5e1',
                  borderRadius: '6px',
                  marginBottom: '14px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <div>
                    <span style={{ fontSize: '12px', color: '#64748b' }}>Depositante: </span>
                    <strong style={{ fontSize: '13px', color: '#0f172a' }}>{cliente}</strong>
                  </div>
                  <div>
                    <span style={{ fontSize: '12px', color: '#64748b' }}>Factura / OC: </span>
                    <strong style={{ fontSize: '13px', color: '#0f172a', fontFamily: 'monospace' }}>{factura}</strong>
                  </div>
                </div>

                <table style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  border: '1.5px solid #000000',
                  fontSize: '12px',
                  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
                }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f1f5f9' }}>
                      <th style={{ border: '1px solid #000000', padding: '7px 8px', textAlign: 'left', width: '18%' }}>SKU / CÓDIGO</th>
                      <th style={{ border: '1px solid #000000', padding: '7px 8px', textAlign: 'left', width: '26%' }}>DESCRIPCIÓN</th>
                      <th style={{ border: '1px solid #000000', padding: '7px 6px', textAlign: 'center', width: '14%' }}>LOTE</th>
                      <th style={{ border: '1px solid #000000', padding: '7px 6px', textAlign: 'center', width: '12%' }}>CADUCIDAD</th>
                      <th style={{ border: '1px solid #000000', padding: '7px 6px', textAlign: 'center', width: '10%' }}>ESPERADO</th>
                      <th style={{ border: '1px solid #000000', padding: '7px 6px', textAlign: 'center', width: '10%' }}>CONFORME</th>
                      <th style={{ border: '1px solid #000000', padding: '7px 6px', textAlign: 'center', width: '10%' }}>MERMA / QA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {skuLines.map((line, i) => (
                      <tr key={i}>
                        <td style={{ border: '1px solid #000000', padding: '6px 8px' }}>
                          <div style={{ fontWeight: 800 }}>{line.codigo}</div>
                          <div style={{ fontSize: '10px', color: '#64748b', fontFamily: 'monospace' }}>EAN: {line.ean}</div>
                        </td>
                        <td style={{ border: '1px solid #000000', padding: '6px 8px' }}>{line.descripcion}</td>
                        <td style={{ border: '1px solid #000000', padding: '6px 6px', textAlign: 'center', fontFamily: 'monospace', fontSize: '11px', fontWeight: 600 }}>
                          {line.lote !== '-' ? (
                            <span style={{ backgroundColor: '#fef3c7', color: '#92400e', padding: '2px 5px', borderRadius: '3px' }}>
                              {line.lote}
                            </span>
                          ) : (
                            <span style={{ color: '#94a3b8' }}>-</span>
                          )}
                        </td>
                        <td style={{ border: '1px solid #000000', padding: '6px 6px', textAlign: 'center', fontFamily: 'monospace', fontSize: '11px', fontWeight: 600 }}>
                          {line.fechaVencimiento !== '-' ? (
                            <span style={{ backgroundColor: '#e0f2fe', color: '#0369a1', padding: '2px 5px', borderRadius: '3px' }}>
                              {line.fechaVencimiento}
                            </span>
                          ) : (
                            <span style={{ color: '#94a3b8' }}>-</span>
                          )}
                        </td>
                        <td style={{ border: '1px solid #000000', padding: '6px 6px', textAlign: 'center', fontWeight: 700 }}>{line.esperada}</td>
                        <td style={{ border: '1px solid #000000', padding: '6px 6px', textAlign: 'center', fontWeight: 700, color: '#059669' }}>{line.conforme}</td>
                        <td style={{ border: '1px solid #000000', padding: '6px 6px', textAlign: 'center', fontWeight: 600, color: line.merma > 0 ? '#d97706' : '#64748b' }}>{line.merma}</td>
                      </tr>
                    ))}
                    <tr style={{ backgroundColor: '#f8fafc', fontWeight: 900 }}>
                      <td colSpan={4} style={{ border: '1.5px solid #000000', padding: '8px 10px', textAlign: 'right' }}>
                        TOTAL PIEZAS FÍSICAS:
                      </td>
                      <td style={{ border: '1.5px solid #000000', padding: '8px 8px', textAlign: 'center' }}>{totalEsperadoSKU}</td>
                      <td style={{ border: '1.5px solid #000000', padding: '8px 8px', textAlign: 'center', color: '#059669' }}>{totalConformeSKU}</td>
                      <td style={{ border: '1.5px solid #000000', padding: '8px 8px', textAlign: 'center', color: totalMermaSKU > 0 ? '#d97706' : '#000000' }}>{totalMermaSKU}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {/* --------------------------------------------------------------------- */}
            {/* SECCIÓN DE FIRMAS DE CONFORMIDAD Y VALIDEZ OPERATIVA                  */}
            {/* --------------------------------------------------------------------- */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '60px',
              marginTop: '45px',
              paddingTop: '20px',
              fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
            }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ borderBottom: '1.5px solid #000000', width: '80%', margin: '0 auto 8px auto' }}></div>
                <div style={{ fontSize: '12px', fontWeight: 800, color: '#000000' }}>
                  Firma y Nombre del Operador Transportista
                </div>
                <div style={{ fontSize: '11px', color: '#475569', marginTop: '2px' }}>
                  {chofer} · Entregó de conformidad
                </div>
              </div>

              <div style={{ textAlign: 'center' }}>
                <div style={{ borderBottom: '1.5px solid #000000', width: '80%', margin: '0 auto 8px auto' }}></div>
                <div style={{ fontSize: '12px', fontWeight: 800, color: '#000000' }}>
                  Firma y Sello Supervisor de Almacén CEDIS
                </div>
                <div style={{ fontSize: '11px', color: '#475569', marginTop: '2px' }}>
                  Giving Out WMS 360+ · Recibió y validó físicamente
                </div>
              </div>
            </div>

          </div>
        </div>

      </div>
    </div>
  );
}
