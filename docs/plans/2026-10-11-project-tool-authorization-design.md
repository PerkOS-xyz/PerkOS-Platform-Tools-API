# AP02: autorización de herramientas de proyecto

La implementación aprobada valida cada consumidor antes de efectos, sin activar pagos ni reparar registros históricos. Endurecer solo Firestore no protege los Admin SDK; validar solo el consumidor no impide falsificar nuevos metadatos. Se combinan ambas capas en releases coordinados de App, API, Chat y Tools.

Tools verifica que el actor firmado esté vinculado al registro global y a un miembro activo del proyecto. Un JWT sin actor no demuestra pertenencia: se rechaza para herramientas de proyecto; los catálogos y herramientas no relacionadas mantienen su contrato. No se deduce autoridad de convId, agentIds, pmAgent, discovery pointers o mirrors editables. Los agentes compartidos necesitan el vínculo explícito del proyecto y su propietario real.

createTask y upsertPlanTask verifican la asignación propuesta antes de crear tareas, documentos, contadores o marcadores. postProjectMessage usa el actor firmado y verifica el coordinador antes del envío. Los errores de autorización son genéricos; un fallo de lectura falla sin efectos. No hay consultas adicionales en heartbeats.

La autorización de proyecto se aplica centralmente a todas las herramientas con projectId. Las comprobaciones de asignación se repiten en los handlers que pueden introducir destinos. Tokens antiguos sin actor requieren actualización del emisor, no un bypass automático.

Pruebas: propietario válido, agente compartido, registro huérfano o cruzado, miembro retirado, roster editable falsificado, Solana sensible a mayúsculas, EVM normalizado, error de lectura y cero escrituras/envíos cuando se rechaza. Baseline: 98 pruebas. Dev requiere imágenes coordinadas y aceptación antes de QA/Prod. No se rellenan memberships desde agentIds.
