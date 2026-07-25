# LogiHERO NDP integration

## Reference Flow

LogiHERO sends diagnostics to NDP from both Android and backend code. Events are tied to the dedicated LogiHERO NDP project.

Project ID:

```text
cms0g920d0001v1mom53he7pk
```

Flow:

1. User taps the cost save button.
2. Android creates one trace ID.
3. Android sends validation and API lifecycle events to NDP.
4. The sync request forwards the trace ID in `X-NDP-Trace-Id`.
5. The backend reads or creates the trace ID.
6. The backend sends request, database, and response events to NDP.
7. Android sends the final API result and UI update event.

## Configuration

Do not commit real ingest keys.

Set these variables before building the Android app or starting the backend:

```powershell
$env:NDP_PROJECT_ID="cms0g920d0001v1mom53he7pk"
$env:NDP_INGEST_ENDPOINT="http://10.0.2.2:4000/api/ingest/events"
$env:NDP_INGEST_KEY="ndp_ingest_full_key_from_ndp"
$env:NDP_ENVIRONMENT="development"
$env:NDP_APP_NAME="LogiHERO"
```

For the backend on the development PC, `NDP_INGEST_ENDPOINT` is usually:

```powershell
$env:NDP_INGEST_ENDPOINT="http://localhost:4000/api/ingest/events"
```

For a real Android phone, `localhost` is the phone itself. Use the PC LAN IP, for example:

```powershell
$env:NDP_INGEST_ENDPOINT="http://192.168.1.20:4000/api/ingest/events"
```

Production backend URL:

```powershell
$env:NDP_BACKEND_BASE_URL="https://logihero-backend.onrender.com/"
```

## Required Ingest Metadata

Both Android and backend ingest calls must include the LogiHERO project ID.

HTTP headers:

```text
X-NDP-Ingest-Key: <real key>
X-NDP-Project-Id: cms0g920d0001v1mom53he7pk
```

JSON body:

```json
{
  "projectId": "cms0g920d0001v1mom53he7pk",
  "event": {
    "serviceName": "LogiHERO"
  }
}
```

## Event Metadata

Use `component` to separate event origin:

- `android`
- `backend`
- `sync`
- `database`
- `web_admin`

Payloads should also include `project: "LogiHERO"` when useful for searching.

## Safety

If NDP configuration is missing, the Android app starts normally and diagnostics stay disabled.

If NDP is unavailable, Android and backend event sending fail silently. LogiHERO business behavior must continue.

Payloads must not include passwords, tokens, authorization headers, secrets, full records, or sensitive personal data.

## Checks

```powershell
$env:JAVA_HOME="C:\Program Files\Android\Android Studio\jbr"
.\gradlew.bat test
.\gradlew.bat assembleDebug
```
