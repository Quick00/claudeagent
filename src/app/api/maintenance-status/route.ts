import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    maintenance: process.env.MAINTENANCE_MODE === 'true',
  });
}
