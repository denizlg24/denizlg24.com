#!/usr/bin/env python3
"""Permit the API's Docker bridges to reach its private host terminal listener."""
import argparse
import ipaddress
import json
import re
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--api-container', required=True)
parser.add_argument('--tailnet-ip', required=True)
args = parser.parse_args()
address = ipaddress.ip_address(args.tailnet_ip)
if address not in ipaddress.ip_network('100.64.0.0/10'):
    raise SystemExit('STOP: terminal listener must use a Tailscale address')
api = json.loads(subprocess.check_output(['docker', 'inspect', args.api_container]))[0]
for name in api['NetworkSettings']['Networks']:
    network = json.loads(subprocess.check_output(['docker', 'network', 'inspect', name]))[0]
    if network['Driver'] != 'bridge':
        continue
    bridge = network.get('Options', {}).get('com.docker.network.bridge.name') or 'br-' + network['Id'][:12]
    if not re.fullmatch(r'[A-Za-z0-9_.:-]{1,15}', bridge):
        raise SystemExit('STOP: invalid API bridge interface')
    for config in network['IPAM']['Config']:
        subnet = ipaddress.ip_network(config['Subnet'])
        if subnet.version != 4:
            continue
        if not subnet.is_private:
            raise SystemExit('STOP: API bridge subnet must be private')
        subprocess.run(['ufw', 'allow', 'in', 'on', bridge, 'from', str(subnet),
                        'to', str(address), 'port', '3003', 'proto', 'tcp'],
                       check=True, stdout=subprocess.DEVNULL)
