#!/usr/bin/env python3
"""Bounded certificate and hostname verification, including PostgreSQL STARTTLS."""
import argparse
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--address', required=True)
parser.add_argument('--host', required=True)
parser.add_argument('--port', required=True, type=int)
parser.add_argument('--starttls', choices=('none', 'postgres'), default='none')
args = parser.parse_args()
if not 1 <= args.port <= 65535:
    raise SystemExit('STOP: invalid TLS port')
command = ['openssl', 's_client', '-connect', f'{args.address}:{args.port}',
           '-servername', args.host, '-verify_hostname', args.host,
           '-verify_return_error', '-brief']
if args.starttls != 'none':
    command += ['-starttls', args.starttls]
try:
    result = subprocess.run(command, input=b'', stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL, timeout=15)
    raise SystemExit(result.returncode)
except subprocess.TimeoutExpired:
    raise SystemExit('STOP: TLS probe timed out')
