{{/*
Chart name, overridable.
*/}}
{{- define "ycgv.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Fully qualified app name. Truncated at 63 characters because some Kubernetes name fields are
limited to that by the DNS label spec.
*/}}
{{- define "ycgv.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "ycgv.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Labels. app.kubernetes.io/version has to survive being a label value, and a digest pin or a
tag with a "+" in it would not, hence the replace/trunc.
*/}}
{{- define "ycgv.labels" -}}
helm.sh/chart: {{ include "ycgv.chart" . }}
{{ include "ycgv.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: {{ include "ycgv.name" . }}
{{- end }}

{{/*
Selector labels - immutable for the life of a Deployment, so nothing version-derived belongs
in here.
*/}}
{{- define "ycgv.selectorLabels" -}}
app.kubernetes.io/name: {{ include "ycgv.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "ycgv.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "ycgv.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
The image reference. A digest wins over a tag when both are set: it is the only form the
image's Sigstore provenance and SBOM attestations can actually be verified against.
*/}}
{{- define "ycgv.image" -}}
{{- if .Values.image.digest -}}
{{- printf "%s@%s" .Values.image.repository .Values.image.digest -}}
{{- else -}}
{{- printf "%s:%s" .Values.image.repository (default .Chart.AppVersion .Values.image.tag) -}}
{{- end -}}
{{- end }}
