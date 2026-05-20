import { Controller, Get, Post, Put, Delete, Param, Query, Body, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '../../prisma.service';

@ApiTags('UoM Conversions')
@Controller('api/uom-conversions')
export class UomController {
  constructor(private prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Listar conversiones UoM (filtrar por skuId)' })
  async getConversions(@Query('skuId') skuId?: string) {
    const where: any = {};
    if (skuId) where.skuId = skuId;

    return this.prisma.uomConversion.findMany({
      where,
      include: {
        sku: { select: { codigo: true, descripcion: true, uomBase: true, clienteId: true } },
      },
      orderBy: { factorConversion: 'desc' },
    });
  }

  @Post()
  @ApiOperation({ summary: 'Crear conversión UoM' })
  async createConversion(@Body() data: any) {
    if (!data.skuId || !data.uomOrigen || !data.uomDestino || !data.factorConversion) {
      throw new HttpException('skuId, uomOrigen, uomDestino y factorConversion son obligatorios', HttpStatus.BAD_REQUEST);
    }

    // Verify SKU exists
    const sku = await this.prisma.skuMaster.findUnique({ where: { id: data.skuId } });
    if (!sku) throw new HttpException('SKU no encontrado', HttpStatus.NOT_FOUND);

    return this.prisma.uomConversion.create({
      data,
      include: { sku: { select: { codigo: true, descripcion: true } } },
    });
  }

  @Put(':id')
  @ApiOperation({ summary: 'Actualizar conversión UoM' })
  async updateConversion(@Param('id') id: string, @Body() data: any) {
    return this.prisma.uomConversion.update({
      where: { id },
      data,
      include: { sku: { select: { codigo: true, descripcion: true } } },
    });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Eliminar conversión UoM' })
  async deleteConversion(@Param('id') id: string) {
    return this.prisma.uomConversion.delete({ where: { id } });
  }

  @Get('convert')
  @ApiOperation({ summary: 'Convertir cantidades entre unidades de medida' })
  async convert(
    @Query('skuId') skuId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('qty') qty: string,
  ) {
    if (!skuId || !from || !to || !qty) {
      throw new HttpException('skuId, from, to y qty son obligatorios', HttpStatus.BAD_REQUEST);
    }

    const quantity = parseFloat(qty);
    if (from === to) return { from, to, quantity, result: quantity };

    const conversion = await this.prisma.uomConversion.findFirst({
      where: { skuId, uomOrigen: from, uomDestino: to },
    });

    if (conversion) {
      return { from, to, quantity, result: quantity * conversion.factorConversion, factor: conversion.factorConversion };
    }

    // Try reverse conversion
    const reverse = await this.prisma.uomConversion.findFirst({
      where: { skuId, uomOrigen: to, uomDestino: from },
    });

    if (reverse) {
      return { from, to, quantity, result: quantity / reverse.factorConversion, factor: 1 / reverse.factorConversion };
    }

    throw new HttpException(`No se encontró conversión de ${from} a ${to} para este SKU`, HttpStatus.NOT_FOUND);
  }
}
