import { prop } from 'common';
import { storedProp } from 'common/storage';
import { opposite } from 'chessground/util';
import { controller as configCtrl } from './explorerConfig';
import xhr = require('./explorerXhr');
import { winnerOf, colorOf } from './explorerUtil';
import * as gameUtil from 'game';
import AnalyseCtrl from '../ctrl';
import { Hovering, ExplorerCtrl, ExplorerData, OpeningData, TablebaseData, SimpleTablebaseHit } from './interfaces';

function pieceCount(fen: Fen) {
  const parts = fen.split(/\s/);
  return parts[0].split(/[nbrqkp]/i).length - 1;
}

function tablebasePieces(variant: VariantKey) {
  switch (variant) {
    case 'standard':
    case 'fromPosition':
    case 'chess960':
      return 7;
    case 'atomic':
    case 'antichess':
      return 6;
    default:
      return 0;
  }
}

export function tablebaseGuaranteed(variant: VariantKey, fen: Fen) {
  return pieceCount(fen) <= tablebasePieces(variant);
}

function tablebaseRelevant(variant: VariantKey, fen: Fen) {
  return pieceCount(fen) - 1 <= tablebasePieces(variant);
}

export default function(root: AnalyseCtrl, opts, allow: boolean): ExplorerCtrl {
  const allowed = prop(allow),
  enabled = root.embed ? prop(false) : storedProp('explorer.enabled', false),
  loading = prop(true),
  failing = prop(false),
  hovering = prop<Hovering | null>(null),
  movesAway = prop(0),
  gameMenu = prop<string | null>(null);

  if ((location.hash === '#explorer' || location.hash === '#opening') && !root.embed) enabled(true);

  let cache = {};
  function onConfigClose() {
    root.redraw();
    cache = {};
    setNode();
  }
  const data = root.data,
  withGames = root.synthetic || gameUtil.replayable(data) || !!data.opponent.ai,
  effectiveVariant = data.game.variant.key === 'fromPosition' ? 'standard' : data.game.variant.key,
  config = configCtrl(data.game, onConfigClose, root.trans, root.redraw);

  const fetch = window.lichess.debounce(function() {
    const fen = root.node.fen;
    const request: JQueryPromise<ExplorerData> = (withGames && tablebaseRelevant(effectiveVariant, fen)) ?
      xhr.tablebase(opts.tablebaseEndpoint, effectiveVariant, fen) :
      xhr.opening(opts.endpoint, effectiveVariant, root.nodeList[0].fen, root.nodeList.slice(1).map(s => s.uci!), config.data, withGames);

    request.then((res: ExplorerData) => {
      cache[fen] = res;
      movesAway(res.moves.length ? 0 : movesAway() + 1);
      loading(false);
      failing(false);
      root.redraw();
    }, () => {
      loading(false);
      failing(true);
      root.redraw();
    });
  }, 250, true);

  const empty = {
    isOpening: true,
    moves: {}
  };

  function setNode() {
    if (!enabled()) return;
    gameMenu(null);
    const node = root.node;
    if (node.ply > 50 && !tablebaseRelevant(effectiveVariant, node.fen)) {
      cache[node.fen] = empty;
    }
    const cached = cache[node.fen];
    if (cached) {
      movesAway(cached.moves.length ? 0 : movesAway() + 1);
      loading(false);
      failing(false);
    } else {
      loading(true);
      fetch();
    }
  };

  return {
    allowed,
    enabled,
    setNode,
    loading,
    failing,
    hovering,
    movesAway,
    config,
    withGames,
    gameMenu,
    current: () => cache[root.node.fen],
    toggle() {
      movesAway(0);
      enabled(!enabled());
      setNode();
      root.autoScroll();
    },
    disable() {
      if (enabled()) {
        enabled(false);
        gameMenu(null);
        root.autoScroll();
      }
    },
    setHovering(fen, uci) {
      hovering(uci ? {
        fen,
        uci,
      } : null);
      root.setAutoShapes();
    },
    fetchMasterOpening: (function() {
      const masterCache = {};
      return (fen: Fen): JQueryPromise<OpeningData> => {
        if (masterCache[fen]) return $.Deferred().resolve(masterCache[fen]).promise() as JQueryPromise<OpeningData>;
        return xhr.opening(opts.endpoint, 'standard', fen, [], {
          db: {
            selected: prop('masters')
          }
        }, false).then((res: OpeningData) => {
          masterCache[fen] = res;
          return res;
        });
      }
    })(),
    fetchTablebaseHit(fen: Fen): JQueryPromise<SimpleTablebaseHit> {
      return xhr.tablebase(opts.tablebaseEndpoint, effectiveVariant, fen).then((res: TablebaseData) => {
        const move = res.moves[0];
        if (move && move.dtz == null) throw 'unknown tablebase position';
        return {
          fen: fen,
          best: move && move.uci,
          winner: res.checkmate ? opposite(colorOf(fen)) : (
            res.stalemate ? undefined : winnerOf(fen, move!)
          )
        } as SimpleTablebaseHit
      });
    }
  };
};
