# Cómo modelar políticas dentro de contratos en EDC con ODRL y DCAT

## Objetivo

Este documento explica cómo plantear políticas de uso y contratos en un conector EDC sin cambiar la arquitectura actual del proyecto. La idea clave es esta:

- ODRL expresa las reglas de uso.
- EDC guarda esas reglas en una `PolicyDefinition`.
- EDC no embebe la política dentro de la `ContractDefinition`; la referencia por identificador.
- DCAT sirve para publicar el asset en catálogo junto con su política visible para terceros.

En otras palabras: si se quiere "meter políticas dentro de contratos", en EDC eso se hace enlazando una política ODRL desde la definición contractual, no duplicando el bloque ODRL completo dentro del contrato.

## Modelo conceptual correcto

La secuencia recomendada es:

1. Crear el asset.
2. Crear una `PolicyDefinition` con una política ODRL.
3. Crear una `ContractDefinition` que apunte a esa política.
4. Publicar el asset en catálogo para que aparezca con metadatos DCAT y con referencia a la política.
5. Negociar el contrato usando la oferta publicada por el proveedor.

La relación entre piezas es:

```text
Asset
  -> PolicyDefinition
       -> policy ODRL
  -> ContractDefinition
       -> accessPolicyId = policy-id
       -> contractPolicyId = policy-id
       -> assetsSelector = asset-id
  -> Dataset DCAT en catálogo
       -> odrl:hasPolicy = política visible en la oferta
```

## Qué hace cada estándar

### ODRL

ODRL es el lenguaje para expresar permisos, prohibiciones, obligaciones y restricciones. Aquí es donde se modela, por ejemplo:

- sólo uso analítico
- sin uso comercial
- limitado a una geografía
- expiración temporal
- obligación de atribución
- prohibición de redistribución

## Qué posibilidades semánticas aporta ODRL

Lo más importante de ODRL no es sólo que permita poner condiciones, sino que ofrece un modelo semántico formal para describir relaciones normativas sobre un recurso. Eso significa que no se limita a decir "este dato tiene restricciones", sino que permite representar con estructura quién puede hacer qué, sobre qué, bajo qué condiciones, con qué prohibiciones y con qué deberes asociados.

Dicho de forma simple: ODRL no es sólo un formato JSON. Es una ontología de política de uso.

### 1. Diferenciar tipos normativos

ODRL distingue semánticamente entre tres grandes categorías:

- `permission`: lo que está permitido.
- `prohibition`: lo que está prohibido.
- `obligation`: lo que debe cumplirse.

Esa distinción es muy potente porque evita meter todas las reglas como si fueran simples filtros. No es lo mismo:

- permitir uso analítico
- prohibir redistribución
- obligar a citar la fuente

Semánticamente son cosas distintas y ODRL las separa de forma nativa.

### 2. Separar acción, objetivo y condición

ODRL modela cada regla como una relación entre:

- una `action`
- un `target`
- cero o más `constraint`

Eso permite expresar frases del tipo:

- se permite `use` sobre este dataset
- se prohíbe `distribute` sobre este asset
- se obliga a `attribute` cuando se reutiliza

La ventaja semántica es que la regla no queda reducida a un texto libre, sino a una estructura interpretable.

### 3. Expresar contexto de uso

ODRL permite condicionar una acción según el contexto. Por ejemplo:

- finalidad del uso
- ámbito geográfico
- ventana temporal
- tipo de actor
- propósito declarado
- canal o ecosistema en el que se consume

Esto es relevante en data spaces porque muchos acuerdos no son absolutos; son situacionales. Un mismo dataset puede ser reutilizable:

- para analítica, pero no para comercialización
- en territorio nacional, pero no fuera de la UE
- hasta cierta fecha, pero no indefinidamente

ODRL da un marco para expresar ese contexto sin convertir la política en una redacción jurídica opaca.

### 4. Representar semántica de uso, no sólo de acceso

Muchos sistemas de control de acceso se quedan en la pregunta "¿puede entrar o no puede entrar?". ODRL va más allá y trabaja sobre uso permitido o prohibido.

Eso abre la puerta a expresar cosas como:

- acceso permitido, pero sólo para consulta
- descarga permitida, pero sin redistribución
- uso permitido, pero con obligación de borrado posterior
- análisis permitido, pero no entrenamiento de modelos

Esta diferencia entre acceso y uso es crítica en conectores y espacios de datos, porque gran parte del valor contractual aparece después del acceso inicial.

### 5. Componer restricciones sin perder estructura

ODRL permite combinar varias restricciones sobre una misma regla. Por ejemplo, una sola `permission` puede depender a la vez de:

- una finalidad concreta
- una geografía concreta
- una fecha límite
- una categoría de uso

Eso permite expresar políticas más ricas que un simple booleano o un rol. Además, semánticamente cada restricción conserva su papel y no queda escondida en una frase larga.

### 6. Reutilizar vocabularios externos

Una fortaleza fuerte de ODRL es que no obliga a usar sólo su propio vocabulario. Puede convivir con otros namespaces para dar significado a los operandos. Por ejemplo:

- `dct:purpose`
- `dct:spatial`
- `dct:accessRights`
- `dcat:theme`
- un namespace propio como `eitel:commercialUse`

Eso permite que la policy herede semántica de Dublin Core, DCAT o vocabularios de dominio. En la práctica, esto significa que ODRL puede servir como contenedor normativo y, al mismo tiempo, apoyarse en términos de negocio más expresivos.

### 7. Representar políticas legibles por máquina y por personas

ODRL tiene una ventaja muy útil para enseñar y documentar: una policy puede leerse casi como una frase normativa, pero sigue siendo procesable por máquina.

Ejemplo conceptual:

```json
{
  "permission": [
    {
      "action": "use",
      "target": "asset-energia-2026",
      "constraint": [
        {
          "leftOperand": "dct:purpose",
          "operator": "eq",
          "rightOperand": "analytics"
        },
        {
          "leftOperand": "eitel:commercialUse",
          "operator": "eq",
          "rightOperand": "no"
        }
      ]
    }
  ]
}
```

Semánticamente eso equivale a algo como:

"Se permite usar este asset si la finalidad es analítica y no hay uso comercial."

### 8. Expresar identidades y roles de forma desacoplada

ODRL puede usarse junto con atributos del sujeto consumidor, aunque esos atributos vengan de otra capa. Por ejemplo, una policy puede referirse conceptualmente a:

- miembros de una federación
- entidades públicas
- operadores certificados
- participantes de una organización o grupo

ODRL no resuelve por sí solo la identidad federada, pero sí ofrece un marco para expresar normativamente cómo afectan esos atributos a los permisos y restricciones.

### 9. Distinguir entre semántica declarada y enforcement técnico

Esta es probablemente la distinción más importante para explicarlo bien.

ODRL aporta semántica declarativa. Es decir, permite decir con precisión qué significan las condiciones de uso. Pero eso no implica automáticamente que cualquier runtime vaya a ejecutar toda esa semántica de forma completa.

Por tanto, hay tres niveles distintos:

- política expresada en ODRL
- política interpretada por el conector
- política realmente forzada en ejecución

Este punto no debilita ODRL; al contrario, aclara su papel. ODRL sirve para representar la intención normativa de forma interoperable. Luego cada plataforma decide hasta dónde la valida, la hace cumplir o la audita.

### 10. Facilitar interoperabilidad semántica entre organizaciones

Si cada organización define sus restricciones con campos ad hoc, el resultado suele ser difícil de intercambiar. ODRL aporta una semántica común que permite que distintas partes reconozcan una misma estructura normativa.

Eso es especialmente útil cuando se quiere:

- publicar políticas en catálogos
- negociar ofertas entre conectores
- mostrar términos de uso en una UI
- auditar o traducir reglas a documentación contractual

En ese sentido, ODRL ayuda a que las políticas no sean sólo locales al software que las creó, sino intercambiables a nivel semántico.

### 11. Soportar políticas simples y políticas avanzadas

ODRL vale tanto para una policy mínima como para una policy rica.

Casos simples:

- permitir uso
- prohibir distribución
- limitar por fecha

Casos avanzados:

- combinar permisos y prohibiciones
- añadir obligaciones posteriores al uso
- representar varias acciones sobre el mismo asset
- usar vocabularios de dominio para clasificar finalidad, sensibilidad o ámbito

Eso lo hace útil como lenguaje base para crecer sin rehacer el modelo.

## Límite práctico de ODRL

ODRL ofrece mucha expresividad semántica, pero no sustituye por sí solo:

- la autenticación
- la autorización técnica en tiempo real
- la negociación contractual completa
- la evidencia de cumplimiento
- la ejecución automática de todas las obligaciones

Lo correcto es verlo como una capa semántica de política. Muy fuerte para describir, interoperar, documentar y apoyar enforcement. Pero no como sustituto único de toda la infraestructura de confianza.

## Frase corta para enseñarlo

Si quieres explicarlo de manera muy directa, esta frase suele funcionar bien:

"ODRL aporta la semántica de las reglas de uso: distingue permisos, prohibiciones y obligaciones; relaciona acciones con recursos y condiciones; y permite expresar políticas interoperables que luego un conector puede publicar, interpretar y, en la medida de su capacidad, hacer cumplir." 

### DCAT

DCAT describe el dataset publicado en catálogo. No sustituye al contrato ni a la policy enforcement interna del conector. Su papel es describir y exponer el recurso para descubrimiento federado.

En una oferta DCAT es razonable incluir:

- título
- descripción
- keywords
- tema o categoría
- identificador del conector
- referencia a la política mediante `odrl:hasPolicy`

### EDC

EDC actúa como capa operativa. Su Management API usa objetos como:

- `PolicyDefinition`
- `ContractDefinition`
- `ContractNegotiation`

EDC decide cómo persiste y aplica esas piezas, pero la semántica de uso la aporta ODRL y la semántica de catálogo la aporta DCAT.

## Regla importante: no mezclar niveles

Hay tres niveles distintos y conviene no mezclarlos:

1. Nivel semántico de política: ODRL.
2. Nivel operacional de publicación y contrato: EDC Management API.
3. Nivel de catálogo e intercambio descriptivo: DCAT.

Si se intenta meter todo en un único JSON, se termina con un diseño difícil de mantener. Lo correcto es mantener las responsabilidades separadas y enlazarlas.

## Cómo se haría en este proyecto

La UI actual ya sigue este patrón:

- construye una política ODRL
- la envía como `PolicyDefinition`
- crea una `ContractDefinition`
- vincula asset y policy por identificador
- genera una vista DCAT del asset con `odrl:hasPolicy`

Esto encaja con lo que aparece en:

- [caas/edc-ui/public/assets/ui/02-operations.js](c:/Users/mario/Documents/EITELConnector/caas/edc-ui/public/assets/ui/02-operations.js#L3955)
- [caas/edc-ui/public/assets/ui/02-operations.js](c:/Users/mario/Documents/EITELConnector/caas/edc-ui/public/assets/ui/02-operations.js#L4020)
- [caas/edc-ui/public/assets/ui/02-operations.js](c:/Users/mario/Documents/EITELConnector/caas/edc-ui/public/assets/ui/02-operations.js#L4087)
- [caas/edc-ui/public/assets/ui/02-operations.js](c:/Users/mario/Documents/EITELConnector/caas/edc-ui/public/assets/ui/02-operations.js#L230)

## Patrón recomendado

### 1. Asset

Primero existe un asset técnico. Ejemplo conceptual:

```json
{
  "@context": {
    "@vocab": "https://w3id.org/edc/v0.0.1/ns/"
  },
  "@id": "asset-padron-municipal-2026",
  "@type": "Asset",
  "properties": {
    "name": "Padron municipal 2026",
    "description": "Dataset de uso administrativo controlado",
    "contenttype": "application/json"
  },
  "dataAddress": {
    "type": "HttpData",
    "baseUrl": "https://api.ayuntamiento.local/padron"
  }
}
```

### 2. PolicyDefinition con ODRL

Después se crea la política reutilizable.

```json
{
  "@context": {
    "@vocab": "https://w3id.org/edc/v0.0.1/ns/"
  },
  "@id": "policy-padron-analitico-no-comercial",
  "@type": "PolicyDefinition",
  "policy": {
    "@context": {
      "odrl": "http://www.w3.org/ns/odrl/2/",
      "dcat": "https://www.w3.org/ns/dcat#",
      "dct": "http://purl.org/dc/terms/",
      "eitel": "https://w3id.org/eitel/ns/"
    },
    "@id": "policy-padron-analitico-no-comercial",
    "@type": "http://www.w3.org/ns/odrl/2/Set",
    "permission": [
      {
        "action": "use",
        "target": "asset-padron-municipal-2026",
        "constraint": [
          {
            "leftOperand": "dct:purpose",
            "operator": "eq",
            "rightOperand": "analytics"
          },
          {
            "leftOperand": "eitel:commercialUse",
            "operator": "eq",
            "rightOperand": "no"
          },
          {
            "leftOperand": "dct:spatial",
            "operator": "eq",
            "rightOperand": "es"
          },
          {
            "leftOperand": "odrl:dateTime",
            "operator": "lteq",
            "rightOperand": "2026-12-31T23:59:59Z"
          }
        ]
      }
    ],
    "prohibition": [],
    "obligation": []
  }
}
```

### 3. ContractDefinition enlazando asset y policy

Aquí está la parte importante: la `ContractDefinition` no mete toda la policy dentro. Referencia la policy por ID.

```json
{
  "@context": {
    "@vocab": "https://w3id.org/edc/v0.0.1/ns/"
  },
  "@id": "contractdef-padron-analitico-no-comercial",
  "@type": "ContractDefinition",
  "accessPolicyId": "policy-padron-analitico-no-comercial",
  "contractPolicyId": "policy-padron-analitico-no-comercial",
  "assetsSelector": [
    [
      {
        "@type": "Criterion",
        "operandLeft": "https://w3id.org/edc/v0.0.1/ns/id",
        "operator": "=",
        "operandRight": "asset-padron-municipal-2026"
      }
    ]
  ]
}
```

## Diferencia entre `accessPolicyId` y `contractPolicyId`

Aunque muchas veces se usa el mismo identificador en ambos campos, conceptualmente no significan exactamente lo mismo:

- `accessPolicyId`: condiciones para acceder a la oferta y poder contratar.
- `contractPolicyId`: condiciones que regirán el acuerdo resultante.

En escenarios simples ambos pueden apuntar a la misma policy.

En escenarios más avanzados se pueden separar. Ejemplo:

- acceso sólo para miembros de una federación concreta
- contrato final además con obligación de borrado, expiración y limitación de finalidad

Ese patrón permite tener una policy de admisión y otra de uso efectivo.

## Cómo aparece esto en DCAT

Cuando el asset se publica en catálogo, se puede representar como `dcat:Dataset` e incluir la policy asociada en `odrl:hasPolicy`.

```json
{
  "@context": {
    "dcat": "https://www.w3.org/ns/dcat#",
    "dct": "http://purl.org/dc/terms/",
    "odrl": "http://www.w3.org/ns/odrl/2/",
    "eitel": "https://w3id.org/eitel/ns/"
  },
  "@type": "dcat:Dataset",
  "@id": "asset-padron-municipal-2026",
  "dct:title": "Padron municipal 2026",
  "dct:description": "Dataset municipal con acceso controlado",
  "dcat:keyword": ["padron", "municipal", "analytics"],
  "dcat:theme": "population",
  "eitel:connectorId": "conectoruc3m",
  "odrl:hasPolicy": {
    "@id": "policy-padron-analitico-no-comercial"
  }
}
```

Si el catálogo o la UI lo necesitan, también puede exponerse la policy completa en vez de sólo la referencia, siempre que el flujo de consumo lo soporte.

## Qué significa "hacer políticas dentro de contratos"

Si se quiere explicar esto a terceros, la formulación más precisa es:

"El contrato no contiene la política embebida como bloque autónomo; el contrato referencia una política ODRL previamente definida y asociada al asset, y esa política puede además exponerse semánticamente en catálogo mediante DCAT + ODRL." 

Eso evita dos errores frecuentes:

- duplicar la misma policy en varios contratos
- mezclar metadatos de catálogo con reglas operativas de enforcement

## Cuándo usar una sola policy y cuándo varias

### Un solo bloque de policy

Es suficiente cuando:

- el control de acceso y el uso posterior son iguales
- no hay distinción entre admisión y ejecución
- el caso es sencillo y demostrativo

### Dos políticas separadas

Tiene sentido cuando:

- una policy decide quién puede contratar
- otra policy decide bajo qué términos puede usar los datos
- hay obligaciones post-contractuales
- hay perfiles de consumidor distintos

Ejemplo conceptual:

- `policy-access-federated-members`
- `policy-contract-analytics-no-redistribution`

Y luego:

```json
{
  "accessPolicyId": "policy-access-federated-members",
  "contractPolicyId": "policy-contract-analytics-no-redistribution"
}
```

## Extensión útil: prohibiciones y obligaciones ODRL

Si se quiere ir más allá de restricciones simples, ODRL permite modelar:

- `prohibition`
- `obligation`

Ejemplo conceptual de obligación:

```json
{
  "obligation": [
    {
      "action": "attribute"
    }
  ]
}
```

Ejemplo conceptual de prohibición:

```json
{
  "prohibition": [
    {
      "action": "distribute",
      "target": "asset-padron-municipal-2026"
    }
  ]
}
```

Aquí hay una advertencia importante: una cosa es que ODRL lo pueda expresar y otra que el runtime EDC concreto lo evalúe y lo haga cumplir automáticamente. Por eso conviene distinguir entre:

- política expresada semánticamente
- política realmente ejecutada por el conector
- política supervisada por procesos externos o auditoría

## Recomendación práctica para enseñar este modelo

La forma más clara de presentarlo es con esta frase:

"En EDC, la policy se define como un recurso independiente con semántica ODRL; la ContractDefinition enlaza esa policy al asset; y la publicación de catálogo puede describir el dataset con DCAT y exponer la policy con `odrl:hasPolicy`." 

Y a continuación mostrar estos tres artefactos por separado:

1. `Asset`
2. `PolicyDefinition`
3. `ContractDefinition`

Eso suele aclarar rápidamente la arquitectura.

## Recomendación para EITEL

Para este proyecto, la opción más coherente es seguir con el patrón actual y extenderlo así:

- mantener `PolicyDefinition` como contenedor de la policy ODRL
- permitir modo avanzado JSON-LD para políticas complejas
- separar `accessPolicyId` y `contractPolicyId` cuando el caso de uso lo requiera
- exponer siempre una vista DCAT del dataset con `odrl:hasPolicy`
- documentar qué restricciones son semánticas y cuáles son realmente aplicadas por el runtime

## Resumen ejecutivo

- Sí se puede hacer un modelo de políticas y contratos rico.
- Lo correcto no es incrustar arbitrariamente la policy dentro del contrato.
- Lo correcto es definir la policy en ODRL, almacenarla como `PolicyDefinition`, enlazarla desde `ContractDefinition` y exponerla semánticamente con DCAT.
- Si se necesita más expresividad, se amplía ODRL; si se necesita más descubrimiento, se amplía DCAT; si se necesita enforcement, se configura EDC o servicios auxiliares.
