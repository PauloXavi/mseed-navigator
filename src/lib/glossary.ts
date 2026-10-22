// Plain-language explanations behind the (!) buttons (<InfoHint term="..." />).
// Single source for these texts. Keep them in sync with backend/mseed_processing.py:
// defaults, the 95 % Nyquist limit and what each option really does.
// Examples marked "nos dados de exemplo" refer to the synthetic files in examples/data.

export interface GlossaryEntry {
  title: string;
  /** What it is (1–2 sentences). */
  what: string;
  /** When to use it / how to read it. */
  when?: string;
  /** Example in this record. */
  example?: string;
}

const ENTRIES = {
  // ---------------------------------------------------------------------------
  // Filtros
  // ---------------------------------------------------------------------------
  frequencyFilter: {
    title: "Filtro de frequência",
    what: "Todo sinal gravado é uma mistura de vibrações lentas e rápidas. O filtro escolhe quais ficam, como o equalizador de um som que realça graves ou agudos.",
    when: "Escolha o tipo conforme o ruído que quer tirar. Atenção: o detector de eventos (STA/LTA) analisa o sinal já filtrado, então o filtro muda quais eventos aparecem.",
  },
  bandpass: {
    title: "Passa-banda",
    what: "Mantém só as vibrações entre freqmin e freqmax e remove o resto.",
    when: "É o mais usado: tira ao mesmo tempo o balanço lento (ondas do mar, vento, temperatura) e o chiado muito rápido.",
    example: "Padrão do app: 1 a 45 Hz.",
  },
  highpass: {
    title: "Passa-alta",
    what: "Mantém só o que vibra mais rápido que freqmin.",
    when: "Para tirar oscilações lentas, como o “microssismo” das ondas do oceano (0,1 a 0,3 Hz), sem cortar nada do lado rápido.",
  },
  lowpass: {
    title: "Passa-baixa",
    what: "Mantém só o que vibra mais devagar que freqmax.",
    when: "Para tirar o chiado de alta frequência e ver o formato geral da onda.",
  },
  bandstop: {
    title: "Rejeita-banda",
    what: "O contrário do passa-banda: remove a faixa entre freqmin e freqmax e mantém todo o resto.",
    when: "Quando o ruído ocupa uma faixa larga e conhecida, como a vibração de uma máquina.",
  },
  notch: {
    title: "Notch",
    what: "Remove uma frequência única, com um corte bem estreito, sem mexer no resto do sinal.",
    when: "Informe uma ou mais frequências separadas por vírgula e espaço (ex.: 60, 29), com ponto nos decimais (59.5). O notch roda antes do filtro de frequência e ignora frequências acima do limite de Nyquist.",
    example:
      "Um registro perto de equipamentos elétricos costuma mostrar um pico forte em 60 Hz (a frequência da rede elétrica no Brasil) e, às vezes, picos de máquinas em outras frequências.",
  },
  notchQ: {
    title: "Fator Q",
    what: "Define a largura do corte do notch.\nQ alto: corta só a frequência exata.\nQ baixo: também apaga as frequências vizinhas.",
    example: "Com Q = 30 (padrão) em 60 Hz, a faixa removida tem cerca de 2 Hz (de 59 a 61 Hz).",
  },
  freqmin: {
    title: "Frequência mínima (freqmin)",
    what: "O limite inferior da faixa do filtro, em hertz (1 Hz = uma vibração por segundo).",
    when: "Usada no passa-banda e no passa-alta. No rejeita-banda, é o início da faixa removida.",
  },
  freqmax: {
    title: "Frequência máxima (freqmax)",
    what: "O limite superior da faixa do filtro, em hertz (1 Hz = uma vibração por segundo).",
    when: "Usada no passa-banda e no passa-baixa. No rejeita-banda, é o fim da faixa removida. O app limita esse valor a 95% do limite de Nyquist.",
  },
  filterOrder: {
    title: "Ordem do filtro",
    what: "Quão abrupto é o corte nas bordas da faixa. Ordem alta: corte mais seco, mas pode criar oscilações falsas perto de picos do sinal.",
    when: "Padrão: 4, um bom equilíbrio. Com a fase zero ligada, o filtro passa duas vezes e o corte fica ainda mais seco.",
  },
  filterFamily: {
    title: "Família do filtro",
    what: "O “formato” do corte.\nButterworth (padrão): corte nítido, sem alterar a amplitude dentro da faixa.\nBessel: corte mais suave, mas preserva melhor o formato da onda no tempo.",
    when: "Se o instante de chegada do evento importa, use Bessel com a fase zero desligada.",
  },
  zeroPhase: {
    title: "Fase zero",
    what: "Ligada: o filtro percorre o sinal duas vezes (ida e volta), sem atrasar nada, mas pode criar uma pequena “sombra” antes do início real de um evento.\nDesligada (filtro causal): percorre uma vez só, como em tempo real; o início fica limpo, com um pequeno atraso.",
    when: "Desligue quando for marcar o instante exato de chegada. Vale também para o notch.",
  },
  nyquist: {
    title: "Limite de Nyquist",
    what: "A maior frequência que a gravação consegue representar: metade da taxa de amostragem.",
    example:
      "Com 250 amostras por segundo, o limite é 125 Hz. O app limita freqmax a 95% desse valor (118,75 Hz) e ignora notch acima dele.",
  },

  // ---------------------------------------------------------------------------
  // Etapas e parâmetros do processamento
  // ---------------------------------------------------------------------------
  despike: {
    title: "Spikes",
    what: "Picos de uma ou poucas amostras causados pelo equipamento (falha de leitura, interferência), e não por vibração do chão. São detectados e trocados por uma reta entre as amostras vizinhas.",
    example:
      "Um glitch típico: uma única amostra de alguns milhões de contagens num registro cujo ruído fica na casa de poucos milhares.",
  },
  demean: {
    title: "Remover média",
    what: "Subtrai o valor médio do registro para o sinal oscilar em torno de zero. Equipamentos costumam ter um pequeno deslocamento constante (offset).",
    example:
      "Um digitalizador com offset de −300 contagens: depois de remover a média, o sinal passa a oscilar em torno de zero.",
  },
  detrend: {
    title: "Detrend linear",
    what: "Remove uma inclinação lenta e constante do registro inteiro (uma reta), como a deriva do sensor com a temperatura.",
  },
  taper: {
    title: "Taper",
    what: "Suaviza o começo e o fim do registro até zero. Sem isso, o filtro “enxerga” um degrau nas bordas e cria oscilações falsas.",
    when: "Eventos nas bordas suavizadas recebem a flag edge, porque ali a amplitude é reduzida.",
  },
  taperSeconds: {
    title: "Duração do taper",
    what: "Quantos segundos em cada borda do registro são suavizados até zero.",
    when: "Padrão: 30 s, respeitando o limite do taper máximo.",
  },
  taperMaxFraction: {
    title: "Taper máximo",
    what: "O maior pedaço do registro que o taper pode suavizar em cada borda, como fração do total.",
    example: "Padrão: 0,05 (5%). Num registro de 3 min, isso limita o taper a 9 s por borda.",
  },
  psdWelch: {
    title: "PSD (Welch)",
    what: "Mostra quanta energia o sinal tem em cada frequência. Picos estreitos costumam ser ruído de máquinas ou da rede elétrica. O método de Welch faz a média de vários trechos para a curva ficar menos ruidosa.",
    when: "Curva bruta: o sinal original, sem os spikes (um glitch de milhões de contagens tem energia em todas as frequências e esconderia o espectro).\nCurva processada: depois de notch e filtro. Onde ela cai, o processamento removeu energia.",
  },
  spectrogram: {
    title: "Espectrograma",
    what: "Imagem que mostra como a energia de cada frequência muda com o tempo.\nEixo horizontal: tempo.\nEixo vertical: frequência.\nCor: energia.",
    when: "Útil para ver ruídos que ligam e desligam, ou um evento que aparece em várias frequências ao mesmo tempo. É gerado para a janela de detalhe (os primeiros 10 minutos).",
  },
  staLta: {
    title: "STA/LTA",
    what: "Detector automático de eventos: compara a energia dos últimos instantes (STA, janela curta) com a de um período mais longo (LTA). Quando a razão passa do trigger_on, um evento começa; quando cai abaixo do trigger_off, termina.",
  },
  spikeZ: {
    title: "spike_z (z robusto)",
    what: "Quantas vezes um ponto precisa se afastar do normal para ser chamado de spike. O “normal” é medido pelo MAD, que não se deixa enganar pelos próprios picos.",
    when: "Padrão: 20. Valores menores marcam mais pontos, com risco de apagar sinal real.",
  },
  spikeWindow: {
    title: "Janela mediana",
    what: "Quantas amostras vizinhas formam a linha de referência (mediana móvel) usada para achar spikes.",
    when: "Padrão: 7 amostras (28 milissegundos a 250 Hz). Precisa ser maior que a largura dos spikes.",
  },
  spikeMaxWidth: {
    title: "Largura máxima",
    what: "O maior número de amostras seguidas que ainda conta como spike. Picos mais largos são tratados como sinal real e preservados.",
    example: "Padrão: 3 amostras. Os glitches dos dados de exemplo têm 1 ou 2.",
  },
  spikeMethod: {
    title: "Método de spike",
    what: "Resíduo de mediana + Hampel (padrão): compara cada ponto com os vizinhos e só marca picos curtos e isolados.\nGlobal (legado): compara cada ponto com o registro inteiro.",
    when: "Evite o global: ele também apaga eventos fortes, porque os picos de um evento grande ficam longe da média do registro inteiro.",
  },
  gapFill: {
    title: "Preenchimento de gaps",
    what: "Como cobrir trechos sem dados (gaps) para o registro ficar contínuo.\nInterpolação linear (padrão): liga os dois lados com uma reta.\nMediana: usa o valor típico do registro.",
    when: "As amostras preenchidas ficam marcadas, e eventos que tocam nelas recebem a flag gap.",
  },
  qcWindow: {
    title: "Janela QC",
    what: "Tamanho dos blocos de tempo usados para medir a qualidade do registro (variação, picos, RMS, spikes, trechos preenchidos ou sinal parado).",
    when: "Padrão: 60 s (mínimo 1 s). Janelas menores mostram variações mais rápidas, com gráficos mais carregados.",
  },
  welchNperseg: {
    title: "Welch nperseg",
    what: "Tamanho de cada trecho usado no cálculo do PSD, em amostras.\nTrechos longos: separam frequências próximas.\nTrechos curtos: dão uma curva mais lisa.",
    example:
      "Padrão: 8192 amostras (cerca de 33 s a 250 Hz), o que separa frequências a cada 0,03 Hz.",
  },
  sta: {
    title: "STA (janela curta)",
    what: "Short-Term Average: a energia média dos últimos instantes. Deve ter mais ou menos a duração do evento que se quer detectar.",
    when: "Padrão: 0,5 s.",
  },
  lta: {
    title: "LTA (janela longa)",
    what: "Long-Term Average: a energia média de um período maior, que representa o ruído de fundo.",
    when: "Padrão: 5 s. Precisa ser maior que a STA.",
  },
  triggerOn: {
    title: "trigger_on",
    what: "Valor da razão STA/LTA a partir do qual um evento começa.",
    when: "Padrão: 8. Mais alto: menos eventos, só os mais bruscos.",
  },
  triggerOff: {
    title: "trigger_off",
    what: "Valor da razão STA/LTA abaixo do qual o evento termina. É menor que o trigger_on para o evento não ficar “piscando” liga-desliga.",
    when: "Padrão: 2.",
  },
  maxEventSeconds: {
    title: "Duração máxima",
    what: "Duração máxima de um evento: se a razão STA/LTA continuar alta por mais tempo, o evento é cortado nesse limite.",
    when: "Padrão: 5 s. Use 0 para não limitar.",
  },
  minEventSeconds: {
    title: "Duração mínima",
    what: "Descarta eventos mais curtos que este valor, que costumam ser ruído.",
    when: "Padrão: 0 (não descarta nada).",
  },
  lowSnr: {
    title: "SNR baixo (flag low_snr)",
    what: "Marca os eventos cujo SNR fica abaixo do limiar escolhido. Eles continuam na tabela e no CSV; a aba Resultados permite escondê-los.",
    when: "Desligado por padrão. Limiar sugerido: 3. Por que marcar em vez de apagar: com um único sensor não dá para confirmar um evento.",
    example: "Com o limiar 3, um candidato com SNR 2,1 recebe a flag; um com SNR 6,9 não.",
  },
  minEventSnr: {
    title: "SNR mínimo (descartar)",
    what: "Remove de vez os eventos com SNR abaixo deste valor: eles não entram na tabela, no CSV nem nas figuras. O resumo informa quantos foram descartados.",
    when: "Padrão: 0 (não descarta nada). Eventos sem SNR calculável (ruído zero antes deles) nunca são descartados.",
  },
  staltaMethod: {
    title: "Método STA/LTA",
    what: "Clássico (padrão): médias simples nas duas janelas.\nRecursivo: médias que “esquecem” o passado aos poucos, como em monitoramento em tempo real.",
    when: "Os dois dão resultados parecidos; o recursivo é o mais comum em sistemas de alerta contínuo.",
  },
  traceId: {
    title: "Trace id",
    what: "O “endereço” de um canal, no formato REDE.ESTAÇÃO.LOCAL.CANAL.",
    when: "Só é necessário se os arquivos tiverem mais de um canal. Aceita * e ? como curingas.",
    example: "Nos dados de exemplo: SY.SYN01.00.HHZ (um único canal).",
  },

  // ---------------------------------------------------------------------------
  // Inspeção
  // ---------------------------------------------------------------------------
  liveFilter: {
    title: "Filtro ao vivo",
    what: "Remove média e tendência, suaviza as bordas e aplica o filtro e o notch escolhidos só na janela exibida, para olhar o sinal sem reprocessar o projeto.",
    when: "Não altera os resultados nem os eventos detectados.",
  },
  gaps: {
    title: "Gaps",
    what: "Trechos em que faltam dados entre um arquivo e o seguinte (o equipamento parou ou perdeu dados).",
    example:
      "Arquivos contíguos cujo relógio deriva alguns ppm não têm gaps: o desalinhamento é tratado à parte, como deriva.",
  },
  mean: {
    title: "Média",
    what: "O valor médio das amostras. Mostra o deslocamento constante (offset) do equipamento.",
  },
  std: {
    title: "Desvio padrão",
    what: "Quanto o sinal costuma se afastar da média: uma medida do nível de ruído (e de eventos) no trecho. Spikes de milhões de contagens inflam esse número; no resumo global aparece também o valor sem eles.",
  },
  p99: {
    title: "p99 |x|",
    what: "Valor que 99% das amostras não ultrapassam, em módulo (ignorando o sinal + ou −). Indica a amplitude alta típica sem ser afetado por um pico isolado.",
  },
  peak: {
    title: "Pico |x|",
    what: "O maior valor absoluto do trecho. Um único spike basta para inflar esse número.",
  },
  npts: {
    title: "N pontos",
    what: "Número de amostras no trecho (duração × taxa de amostragem).",
    example: "1 minuto a 250 Hz = 15 000 amostras.",
  },

  // ---------------------------------------------------------------------------
  // Resultados
  // ---------------------------------------------------------------------------
  mad: {
    title: "MAD",
    what: "Desvio absoluto mediano: a mediana das distâncias de cada amostra até a mediana do registro. Mede a variação típica sem ser afetado por picos extremos.",
    example:
      "Um registro com ruído de ±4 mil contagens e alguns glitches de milhões: o MAD continua na casa dos milhares, enquanto o desvio padrão dispara.",
  },
  robustThreshold: {
    title: "Limiar robusto",
    what: "A distância mínima, em desvios “robustos”, para um ponto virar spike (o spike_z). O desvio robusto vem do MAD, então os próprios picos não o inflam.",
  },
  spikeGroups: {
    title: "Spikes (grupos)",
    what: "Primeiro número: amostras marcadas como spike.\nEntre parênteses: quantos episódios separados elas formam (amostras vizinhas contam como um).",
    example: "8 (7): sete glitches, um deles com 2 amostras.",
  },
  filledSamples: {
    title: "Amostras preenchidas",
    what: "Quantas amostras foram criadas para cobrir gaps reais, pelo método escolhido. Não inclui os ajustes de deriva de relógio.",
  },
  missingSamples: {
    title: "Amostras ausentes",
    what: "Quantas amostras faltam em cada gap (duração × taxa de amostragem). Em overlaps, indica o tamanho do trecho gravado duas vezes.",
  },
  gapsOverlaps: {
    title: "Gaps e overlaps",
    what: "Gap: trecho sem dados entre dois arquivos.\nOverlap: trecho gravado duas vezes (dois arquivos cobrem o mesmo tempo); vale o arquivo posterior.",
  },
  effectiveTaper: {
    title: "Taper efetivo",
    what: "A duração realmente suavizada em cada borda, depois de aplicar o limite do taper máximo.",
  },
  samplingRate: {
    title: "Taxa amostral",
    what: "Quantas medidas o equipamento grava por segundo, em hertz.",
    example:
      "250 Hz: uma medida a cada 4 milésimos de segundo. Os dados de exemplo usam 100 Hz. Se o relógio do equipamento derivar, a taxa efetiva fica um pouco diferente da nominal (o resumo mostra a deriva em ppm).",
  },
  bandEnergy: {
    title: "Distribuição da potência por banda",
    what: "Divide o espectro em faixas de frequência e mostra a porcentagem da energia total em cada uma.",
    when: "Compare bruto e processado para ver de onde o processamento tirou energia. As bandas não cobrem o espectro inteiro, então a soma pode ficar abaixo de 100%.",
    example:
      "Perto de redes elétricas de 60 Hz, a banda 40–80 Hz pode concentrar a maior parte da energia bruta, puxada pelo pico da rede.",
  },
  staLtaEvents: {
    title: "Eventos STA/LTA",
    what: "Trechos em que o detector viu um aumento brusco de energia. São candidatos: podem ser eventos sísmicos, máquinas, pancadas perto do sensor ou ruído.",
    when: "Confirmar a origem exige mais estações ou sensores de 3 componentes.",
  },
  maxStaLta: {
    title: "Máx. STA/LTA",
    what: "O maior valor da razão STA/LTA durante o evento. Quanto maior, mais brusco foi o aumento de energia.",
    example: "No método clássico, o máximo possível é LTA ÷ STA: com os padrões (5 s e 0,5 s), 10.",
  },
  maxAmplitudeFiltered: {
    title: "Máx. |amplitude| filtrada",
    what: "O maior valor absoluto do sinal filtrado durante o evento, em contagens.",
  },
  rms: {
    title: "RMS",
    what: "Raiz da média dos quadrados: a amplitude típica de um trecho, considerando todas as amostras (não só o pico).",
  },
  snr: {
    title: "SNR",
    what: "Relação sinal-ruído: o RMS do evento dividido pelo RMS da janela LTA logo antes dele (5 s por padrão).",
    when: "Perto de 1: o evento mal se destaca do ruído.\nAcima de 3: destaca-se bem.",
  },
  dominantFrequency: {
    title: "f dominante",
    what: "A frequência com mais energia dentro do evento, em Hz.",
    when: "Ajuda a separar fontes: máquinas e rede elétrica têm frequências fixas; eventos naturais variam.",
  },
  flags: {
    title: "Flags",
    what: "Alertas de qualidade de cada evento.",
    when: "gap: o evento, ou a janela LTA antes dele, toca amostras preenchidas em um gap.\nedge: o evento está numa borda suavizada pelo taper, onde a amplitude é reduzida.\nlow_snr: SNR abaixo do limiar escolhido (só quando a marcação está ligada).",
  },
  qcWindows: {
    title: "Indicadores de QC por janela",
    what: "O registro é dividido em blocos (janela QC). Em cada um, mede-se: o desvio padrão, o p99 em relação à média do bloco e o RMS do sinal processado.",
    when: "Picos isolados no gráfico: blocos com eventos ou glitches.\nSubidas largas: períodos mais ruidosos.",
  },
  counts: {
    title: "Contagens (counts)",
    what: "A unidade bruta do digitalizador: números inteiros, sem conversão para velocidade ou aceleração do chão.",
    when: "Converter para unidades físicas exige a resposta do instrumento (arquivo StationXML), que não acompanha estes dados.",
  },

  // ---------------------------------------------------------------------------
  // Arquivos
  // ---------------------------------------------------------------------------
  network: {
    title: "Rede",
    what: "Código da rede de estações à qual o sensor pertence (até 2 caracteres).",
    example: "Nos dados de exemplo: SY.",
  },
  station: {
    title: "Estação",
    what: "Código do local de instalação do sensor (até 5 caracteres). Não traz coordenadas: a posição fica num arquivo de metadados à parte (StationXML).",
    example: "Nos dados de exemplo: SYN01.",
  },
  channel: {
    title: "Canal",
    what: "Código de 3 letras: faixa de taxa de amostragem, tipo de instrumento e direção do movimento medido.",
    example:
      "Nos dados de exemplo: HHZ.\nH: de 80 a 250 amostras por segundo, banda larga.\nH: sismômetro de alto ganho.\nZ: movimento vertical.",
  },
  trace: {
    title: "Trace",
    what: "Uma série contínua de amostras de um canal, identificada por REDE.ESTAÇÃO.LOCAL.CANAL.",
    example:
      "Nos dados de exemplo: SY.SYN01.00.HHZ. O “00” é o código de local: separa sensores na mesma estação (não é uma posição).",
  },
  miniseed: {
    title: "MiniSEED",
    what: "Formato padrão internacional para dados sísmicos: guarda as amostras compactadas, o horário de início e a identificação do canal.",
    example:
      "Um dia gravado em arquivos de 1 minuto são 1440 arquivos. Os dados de exemplo têm 3 arquivos de 3 minutos.",
  },
} satisfies Record<string, GlossaryEntry>;

export type GlossaryKey = keyof typeof ENTRIES;

export const GLOSSARY: Record<GlossaryKey, GlossaryEntry> = ENTRIES;
