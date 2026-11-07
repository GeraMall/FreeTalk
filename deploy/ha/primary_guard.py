"""Read-only ExecCondition: a node needs a fresh owner proof before serving."""
import json
import pathlib
import time


def permitted(config, proof, now):
    node=config.get('node')
    until=proof.get('until')
    return (config.get('armed') is True and node in ('moscow','petersburg')
        and proof.get('node')==node and proof.get('owner')==node
        and type(proof.get('epoch')) is int and proof['epoch']>0
        and type(until) in (float,int) and now<until<=now+180
        and proof.get('fencePending') is False)


def main():
    try:
        config=json.loads(pathlib.Path('/etc/trlka-ha/automatic.json').read_text())
        proof=json.loads(pathlib.Path('/run/trlka-ha/owner.json').read_text())
        return 0 if permitted(config,proof,time.time()) else 1
    except Exception:
        return 1


if __name__=='__main__':
    raise SystemExit(main())
