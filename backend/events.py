"""Tiny in-process publish/subscribe used for real-time updates (Server-Sent Events).

Each browser connection is tagged with the hospital it may see and whether it may receive alerts:
  * doctors and nurses only receive events for their own hospital, including alert details;
  * Admin receives events for every hospital but NEVER any alert information."""
import json, queue, threading

_clients = {}          # queue -> (hospital_id or None for "all", alerts_allowed)
_lock = threading.Lock()
ALERT_KEYS = ("alert_raised", "alert_level", "alert_type")
ALERT_ONLY_EVENTS = ("ack", "resolve")


def subscribe(hospital_id=None, alerts=True):
    q = queue.Queue(maxsize=200)
    with _lock:
        _clients[q] = (hospital_id, alerts)
    return q


def unsubscribe(q):
    with _lock:
        _clients.pop(q, None)


def publish(event):
    """Send an event dict to every connected browser that is allowed to see it."""
    with _lock:
        targets = list(_clients.items())
    for q, (hospital_id, alerts) in targets:
        if hospital_id is not None and event.get("hospital_id") not in (None, hospital_id):
            continue
        if not alerts:
            if event.get("type") in ALERT_ONLY_EVENTS:
                continue
            event_out = {k: v for k, v in event.items() if k not in ALERT_KEYS}
        else:
            event_out = event
        try:
            q.put_nowait(event_out)
        except queue.Full:
            pass


def sse_format(event):
    return f"data: {json.dumps(event)}\n\n"


def client_count():
    with _lock:
        return len(_clients)
