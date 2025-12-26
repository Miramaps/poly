import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const DASH_USER = process.env.DASH_USER || 'admin';
const DASH_PASS = process.env.DASH_PASS || 'sexmachine666';

export function middleware(request: NextRequest) {
  const authHeader = request.headers.get('authorization');

  if (!authHeader) {
    return new NextResponse('Authentication required', {
      status: 401,
      headers: {
        'WWW-Authenticate': 'Basic realm="Poly Trader Dashboard"',
      },
    });
  }

  const [scheme, encoded] = authHeader.split(' ');

  if (scheme !== 'Basic' || !encoded) {
    return new NextResponse('Invalid authentication', {
      status: 401,
      headers: {
        'WWW-Authenticate': 'Basic realm="Poly Trader Dashboard"',
      },
    });
  }

  const decoded = atob(encoded);
  const [username, password] = decoded.split(':');

  if (username !== DASH_USER || password !== DASH_PASS) {
    return new NextResponse('Invalid credentials', {
      status: 401,
      headers: {
        'WWW-Authenticate': 'Basic realm="Poly Trader Dashboard"',
      },
    });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

