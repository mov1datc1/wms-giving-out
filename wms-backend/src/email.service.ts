import * as nodemailer from 'nodemailer';
import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Injectable()
export class EmailService {
  constructor(private prisma: PrismaService) {}

  private async getConfig() {
    const settings = await this.prisma.systemSetting.findMany();
    const cfg: Record<string, string> = {};
    settings.forEach((s: any) => { cfg[s.key] = s.value; });
    return {
      host: cfg['email.smtp_host'] || 'mail.movidatci.com',
      port: parseInt(cfg['email.smtp_port'] || '465'),
      secure: (cfg['email.smtp_port'] || '465') === '465',
      user: cfg['email.smtp_user'] || 'wms@movidatci.com',
      pass: cfg['email.smtp_pass'] || '',
      from: cfg['email.from_name'] || 'Giving Out WMS',
    };
  }

  private async createTransport() {
    const cfg = await this.getConfig();
    return nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: { user: cfg.user, pass: cfg.pass },
      tls: { rejectUnauthorized: false },
    });
  }

  async sendTaskNotification(task: any) {
    if (!task.asignadoA) return { success: false, error: 'No recipient email' };

    try {
      const cfg = await this.getConfig();
      const transport = await this.createTransport();

      const alertInfo = task.alerta ? `
        <div style="background:#f8f9fa;padding:12px 16px;border-radius:8px;border-left:4px solid #0d9488;margin-bottom:16px;">
          <strong style="color:#0d9488;">📋 Alerta Origen:</strong><br/>
          <span style="font-weight:600;">${task.alerta.titulo}</span>
        </div>` : '';

      const prioColors: Record<string, string> = { URGENTE: '#dc2626', ALTA: '#f59e0b', MEDIA: '#3b82f6', BAJA: '#6b7280' };
      const prioColor = prioColors[task.prioridad] || '#3b82f6';

      const html = `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"></head>
        <body style="font-family:'Segoe UI',Arial,sans-serif;background:#f0f4f8;padding:20px;">
          <div style="max-width:600px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
            <div style="background:linear-gradient(135deg,#0f172a,#1e293b);padding:24px 28px;color:white;">
              <div style="font-size:12px;opacity:0.7;margin-bottom:4px;">📦 GIVING OUT WMS</div>
              <h1 style="margin:0;font-size:20px;">Nueva Tarea Asignada</h1>
            </div>
            <div style="padding:24px 28px;">
              <p>Hola <strong>${task.asignadoNombre || task.asignadoA}</strong>,</p>
              <p>Se te ha asignado una nueva tarea en el sistema WMS:</p>
              
              <div style="background:#fafafa;padding:16px 20px;border-radius:8px;border:1px solid #e2e8f0;margin:16px 0;">
                <h2 style="margin:0 0 8px;font-size:16px;color:#0f172a;">${task.titulo}</h2>
                ${task.descripcion ? `<p style="margin:4px 0;color:#64748b;font-size:14px;">${task.descripcion}</p>` : ''}
                <div style="display:flex;gap:16px;margin-top:12px;flex-wrap:wrap;">
                  <span style="font-size:12px;"><strong>Área:</strong> ${task.area}</span>
                  <span style="font-size:12px;"><strong>Prioridad:</strong> <span style="color:${prioColor};font-weight:700;">${task.prioridad}</span></span>
                  ${task.fechaLimite ? `<span style="font-size:12px;"><strong>Fecha límite:</strong> ${new Date(task.fechaLimite).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}</span>` : ''}
                </div>
              </div>

              ${alertInfo}
              
              ${task.notas ? `<div style="margin-top:12px;"><strong>📝 Instrucciones:</strong><br/><span style="color:#475569;">${task.notas}</span></div>` : ''}
              
              <p style="margin-top:20px;font-size:13px;color:#94a3b8;">
                Tarea creada por: ${task.creadoPor || 'Sistema'}<br/>
                Fecha: ${new Date().toLocaleString('es-MX', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
            <div style="background:#f8fafc;padding:16px 28px;text-align:center;font-size:12px;color:#94a3b8;border-top:1px solid #e2e8f0;">
              Giving Out WMS · Tepotzotlán, Estado de México
            </div>
          </div>
        </body>
        </html>
      `;

      const result = await transport.sendMail({
        from: `"${cfg.from}" <${cfg.user}>`,
        to: task.asignadoA,
        subject: `📋 Tarea asignada: ${task.titulo} [${task.prioridad}]`,
        html,
      });

      console.log(`✅ Email sent to ${task.asignadoA}: ${result.messageId}`);
      return { success: true, messageId: result.messageId };
    } catch (error: any) {
      console.error(`❌ Email error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  async testConnection() {
    try {
      const transport = await this.createTransport();
      await transport.verify();
      return { success: true, message: 'Conexión SMTP exitosa' };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }
}
