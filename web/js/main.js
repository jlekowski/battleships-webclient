'use strict';
var BattleshipsClass = function() {
    // events log management
    var debug = !!localStorage.getItem('debug'),
    // API's base URL
        baseUrl = 'http://battleships-api.private/v1',
    // battle boards axis Y legend
        axisY = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'],
    // battle boards axis X legend
        axisX = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    // whether the game has started
        gameStarted = false,
    // whether the game has ended
        gameEnded = false,
    // whether player started the game
        playerStarted = false,
    // whether opponent started the game
        otherStarted = false,
    // prevents shooting
        shotInProgress = false,
    // player number 1 or 2
        playerNumber,
    // which player's turn is now
        whoseTurn = 0,
    // battle boards
        $battleground = null,
    // authentication token
        gameToken,
    // game Id
        gameId,
    // id of the last event retrieved from API
        lastIdEvents = 0;

    this.run = function() {
        var gameInfo;

        // default settings for AJAX calls
        $.ajaxSetup({
            dataType: 'json',
            contentType: 'application/json',
            processData: false,
            beforeSend: function(jqXHR, settings) {
                console.info('Loading START');
                if (debug) {
                    console.log('url: %s%s', baseUrl, settings.url);
                    console.log('payload: %s', settings.data);
                }
                settings.url = baseUrl + settings.url;
                settings.data = JSON.stringify(settings.data);
                if (gameToken) {
                    jqXHR.setRequestHeader('Authorization', 'Bearer ' + gameToken);
                }
            },
            complete: function(jqXHR, textStatus) {
                if (debug) {
                    console.log('textStatus: %s', textStatus);
                    console.log(jqXHR.responseJSON);
                }
                console.info('Loading STOP');
            },
            error: function(jqXHR) {
                console.error(jqXHR.responseJSON);
            },
            dataFilter: function(data, type) {
                return (type === 'json' && data === '') ? null : data;
            }
        });

        $battleground = $('div:gt(0) div:not(:first-child)', 'div.board');
        $battleground.board = function(index) {
            return index === 0 ? $battleground.slice(0, 100) : $battleground.slice(100);
        };

        // board handling
        $battleground.on('click', battlegroundClickCallback);

        // starting the game
        $('#start').on('click', startClickCallback);

        // updating player's name
        $('.name_update')
            .on('click', nameUpdateClickCallback)
            .siblings(':text')
            .on({keyup: nameUpdateTextKeyupCallback, blur: nameUpdateTextBlurCallback});

        // starts new game
        $('#new_game').on('click', newGameClickCallback);

        // shoot randomly
        $('#random_shot').on('click', randomShot);

        // set ships randomly
        $('#random_ships').on('click', {retry: 2}, randomShips);

        // check for updates
        $('#check_update').on('click', {gt: lastIdEvents}, getEvents);

//            gameToken = '00f2ef74057859017ad48d1ff59f7767';
//            gameId = 63;

        gameInfo = location.hash.replace(/^#/, '').split(';');
        if (gameInfo.length > 1) {
            gameToken = gameInfo[0];
            gameId = parseInt(gameInfo[1]);
            console.info('Game from hash (token, id)', gameToken, gameId);
            getGame().done(getEvents);
        } else {
            addGame().done(getGame);
        }
    };

    function battlegroundClickCallback() {
        var $field = $(this);

        // shoot if other board
        if ($battleground.index($field) >= 100) {
            shot($field);
            // on your board toggle ships only if not started yet
        } else if (!playerStarted) {
            $field.toggleClass('ship');
        }
    }

    function startClickCallback() {
        if (gameStarted) {
            alert('You have already started the game');
            return false;
        }

        var $board = $battleground.board(0);
        if (checkShips($board) === false) {
            alert('There is either not enough ships or they\'re set incorrectly');
            return false;
        }

        var playerShips = $board.filter('.ship').map(function() {
            return getCoords(this);
        }).toArray();

        $.ajax({
            url: '/games/' + gameId,
            method: 'PATCH',
            data: {playerShips: playerShips},
            success: function(data) {
                gameStarted = true;
                $('#start').prop('disabled', true);
                $('#random_shot, #random_ships').toggle();
                setTurn(findWaitingPlayer());
                addEvent('start_game');
            }
        });
    }

    /**
     * @param {String} type
     * @param {String} [value]
     * @return {Object} jqXHR
     */
    function addEvent(type, value) {
        return $.ajax({
            url: '/games/' + gameId + '/events',
            method: 'POST',
            data: {type: type, value: value},
            success: function(data, textStatus, jqXHR) {
                // @todo DRY
                lastIdEvents = parseInt(jqXHR.getResponseHeader('Location').match(/\d+$/)[0]);
            }
        });
    }

    /**
     * @return {Object} jqXHR
     */
    function addGame() {
        return $.ajax({
            url: '/games',
            method: 'POST',
            data: {playerName: 'Test Player'},
            success: function(data, textStatus, jqXHR) {
                gameToken = jqXHR.getResponseHeader('Game-Token');
                gameId = parseInt(jqXHR.getResponseHeader('Location').match(/\d+$/)[0]);
                location.hash = [gameToken, gameId].join(';');
                console.info('Game created (token, id)', gameToken, gameId);
            }
        });
    }

    /**
     * @return {Object} jqXHR
     */
    function getGame() {
        return $.ajax({
            url: '/games/' + gameId,
            method: 'GET',
            success: function(data) {
                var key,
                    $field,
                    $board = $battleground.board(0);

                if (data.playerShips.length > 0) {
                    for (key in data.playerShips) {
                        $field = getFieldByCoords(data.playerShips[key], $board);
                        $field.addClass('ship');
                    }
                    gameStarted = true;
                    $('#start').prop('disabled', true);
                    $('#random_shot, #random_ships').toggle();
                    setTurn(findWaitingPlayer());
                }

                playerNumber = data.playerNumber;
                $('.player_name').text(data.playerName);
                $('.other_name').text(data.otherName);
            }
        });
    }

    /**
     * @param {Object} event
     * @return {Object} jqXHR
     */
    function getEvents(event) {
        var filters = event.data ? '?' + $.param(event.data) : '';

        return $.ajax({
            url: '/games/' + gameId + '/events' + filters,
            method: 'GET',
            success: function(data) {
                handleEvents(data);
                checkGameEnd();
                // start AJAX calls for updates
//                    $('#update').triggerHandler('click');
            }
        });
    }

    function handleEvents(events) {
        var i,
            event,
            shotResult,
            lastShot = {},
            position,
            $field,
            boardNumber;

        for (i = 0; i < events.length; i++) {
            event = events[i];

            console.log('event type `%s` and value `%s`', event.type, event.value);
            switch (event.type) {
                case 'name_update':
                    if (event.player !== playerNumber) {
                        $('.other_name').text(event.value);
                    }
                    break;

                case 'start_game':
                    if (event.player !== playerNumber) {
                        setTurn(playerNumber - 1);
                        otherStarted = true;
                    } else {
                        playerStarted = true;
                    }
                    gameStarted = playerStarted && otherStarted;
                    break;

                case 'join_game':
                    if (event.player !== playerNumber) {
                        $('.board_menu:eq(1) span').css({fontWeight: 'bold'});
//                            $('#game_link').text('');
                    }
                    break;

                case 'shot':
                    shotResult = event.value.split('|');
                    boardNumber = event.player === playerNumber ? 1 : 0;
                    $field = getFieldByCoords(shotResult[0], $battleground.board(boardNumber));
                    position = new PositionClass(getPosition($field), boardNumber);

                    markShot(position, shotResult[1]);
                    lastShot = {player: event.player, result: shotResult[1]};
                    break;

                case 'chat':
//                        chat_append(event.text, false, event.timestamp);
                    break;
            }

            lastIdEvents = event.id;
        }

        if (lastShot.result === 'sunk') {
            checkGameEnd();
        } else if (lastShot.result === 'miss') {
            // @todo from API playerNumber 1|2 while here 0|1
            setTurn(lastShot.player === playerNumber ? 1 : 0);
        }
    }

    function nameUpdateClickCallback() {
        var $name = $(this),
            $input = $name.siblings(':text');

        $input.val($name.text());
        $name.hide();
        $input.show().select();
    }

    function nameUpdateTextKeyupCallback(event) {
        var $input, newName, $nameElement, nameClassSelector;

        // if pressed ESC - leave the input, if ENTER - process, if other - do nothing
        if (event.which !== 13) {
            if (event.which === 27) {
                $(this).blur();
            }

            return true;
        }

        $input = $(this);
        newName = $input.val();
        $nameElement = $input.hide().siblings('span');
        nameClassSelector = $nameElement.hasClass('player_name') ? '.player_name' : '.other_name';

        $.ajax({
            url: '/games/' + gameId,
            method: 'PATCH',
            data: {playerName: newName},
            success: function(data) {
                customLog({name: newName});
                $(nameClassSelector).text(newName);
                $nameElement.show();
            }
        });
    }

    function nameUpdateTextBlurCallback() {
        var $input = $(this);

        if ($input.has(':visible')) {
            $input.hide();
            $input.siblings('span').show();
        }
    }

    function newGameClickCallback() {
        if (gameEnded || confirm('Are you sure you want to quit the current game?')) {
            $battleground.removeClass();
            gameStarted = false;
            gameEnded = false;
            playerStarted = false;

            setTurn(0);

            $('#start').prop('disabled', false);
            $('#random_shot').hide();
            $('#random_ships').show();
            $('div.board').removeClass('hide_ships');
        }
    }

    function shot($field) {
        if (!gameStarted) {
            alert('You can\'t shoot at the moment - game has not started');
            return;
        }

        if (whoseTurn !== 0) {
            alert('It\'s other player\'s turn');
            return;
        }

        if ($field.is('.miss, .hit')) {
            customLog('You either already shot this field, or no ship could be there');
            return;
        }

        if (shotInProgress) {
            alert('Shot in progress - wait for the result first');
            return;
        }

        shotInProgress = true;
        addEvent('shot', getCoords($field)).done(function(data) {
            var position = new PositionClass(getPosition($field), findWaitingPlayer()),
                shotResult = data.result;

            markShot(position, shotResult);

            if (shotResult === 'miss') {
                setTurn(findWaitingPlayer());
            }

            if (shotResult === 'sunk') {
                checkGameEnd();
            }
        }).always(function() {
            shotInProgress = false;
        });
    }

    /**
     * @param {Object} element
     * @return {String}
     */
    function getCoords(element) {
        var index = $battleground.index(element),
            indexes,
            coordY,
            coordX;

        indexes = indexToArray(index);

        coordY = axisY[ indexes[1] ];
        coordX = axisX[ indexes[0] ];

        return coordY + coordX;
    }

    /**
     * @param {String} coords
     * @param {Object} $board
     * @return {Object} DOM Element
     */
    function getFieldByCoords(coords, $board) {
        var positionY = $.inArray(coords.substr(0, 1), axisY),
            positionX = $.inArray(parseInt(coords.substr(1)), axisX),
        // parseInt('08') -> 0
            position = parseInt([positionX, positionY].join(''), 10);

        return $board.eq(position);
    }

    /**
     * @param {PositionClass} position
     * @param {string} shotResult
     * @param {Number} [direction]
     */
    function markShot(position, shotResult, direction) {
        var markClass = '',
            missedPositions = [],
            $closeField,
            i;

        switch (shotResult) {
            case 'miss':
                markClass = 'miss';
                missedPositions.push(position);
                break;

            case 'hit':
                markClass = 'hit';
                missedPositions = position.getCornerPositions();
                break;

            case 'sunk':
                markClass = 'hit';
                missedPositions = position.getSurroundingPositions();
                break;
        }

        for (i = 0; i < missedPositions.length; i++) {
            var missedPosition = missedPositions[i];
            if (missedPosition === null || (direction !== undefined && direction !== i)) {
                continue;
            }

            $closeField = missedPosition.getField();
            if ($closeField.hasClass('hit') && shotResult === 'sunk') {
                markShot(missedPosition, shotResult, i);
            } else {
                $closeField.addClass('miss');
            }
        }

        if (direction === undefined) {
            position.getField().addClass(markClass);
        }
    }

    /**
     * @param {PositionClass} position
     * @param {Number} [direction]
     * @return {Boolean}
     */
    function isSunk(position, direction) {
        var sidePositions = position.getSidePositions(),
            sidePosition,
            $sideField,
            i;

        // @DRY - same as in mark_shot
        for (i = 0; i < sidePositions.length; i++) {
            sidePosition = sidePositions[i];
            if (sidePosition === null || (direction !== undefined && direction !== i)) {
                continue;
            }

            $sideField = sidePosition.getField();
            if ($sideField.hasClass('hit')) {
                if (isSunk(sidePosition, i) === false) {
                    return false;
                }
            } else if ($sideField.hasClass('ship')) {
                return false;
            }
        }

        return true;
    }

    function checkGameEnd() {
        if (gameEnded) {
            return;
        }

        if ($battleground.board(0).filter('.hit').length >= 20) {
            alert($('.other_name:first').text() + ' won');
            gameEnded = true;
        } else if ($battleground.board(1).filter('.hit').length >= 20) {
            alert($('.player_name:first').text() + ' won');
            gameEnded = true;
        }
    }

    /**
     * @param {Number} playerNumber
     */
    function setTurn(playerNumber) {
        whoseTurn = playerNumber;
        $('.board_menu:eq(' + whoseTurn + ') span').addClass('turn');
        $('.board_menu:eq(' + findWaitingPlayer() + ') span').removeClass('turn');
    }

    /**
     * @return {Number}
     */
    function findWaitingPlayer() {
        return whoseTurn === 0 ? 1 : 0;
    }

    /**
     * @param {Object} $board
     * @return {Boolean}
     */
    function checkShips($board) {
        var shipsArray,
            shipsLength = 20,
            shipsTypes = {1:0, 2:0, 3:0, 4:0},
            directionMultipliers = [1, 10],
            topRightCorner,
            bottomRightCorner,
            borderIndex,
            borderDistance,
            index,
            key,
            idx,
            i, j, k;

        shipsArray = $board.filter('.ship').map(function() {
            return $board.index(this);
        }).toArray();
        if (shipsArray.length !== shipsLength) {
            customLog('incorrect number of masts');
            console.info(shipsArray);
            return false;
        }

        // check if no edge connection
        for (i = 0; i < shipsArray.length; i++) {
            idx = indexToArray(shipsArray[i]);

            if (idx[0] === 9) {
                continue;
            }

            topRightCorner = (idx[1] > 0) && ($.inArray(shipsArray[i] + 9, shipsArray) !== -1);
            bottomRightCorner = (idx[1] < 9) && ($.inArray(shipsArray[i] + 11, shipsArray) !== -1);

            if (topRightCorner || bottomRightCorner) {
                customLog('edge connection');
                return false;
            }
        }

        // check if there are the right types of ships
        for (i = 0; i < shipsArray.length; i++) {
            // we ignore masts which have already been marked as a part of a ship
            if (shipsArray[i] === null) {
                continue;
            }

            idx = indexToArray(shipsArray[i]);

            for (j = 0; j < directionMultipliers.length; j++) {
                borderIndex = parseInt(j) === 1 ? 0 : 1;
                borderDistance = parseInt(idx[borderIndex]);

                k = 1;
                // battleground border
                while (borderDistance + k <= 9) {
                    index = shipsArray[i] + (k * directionMultipliers[j]);
                    key = $.inArray(index, shipsArray);

                    // no more masts
                    if (key === -1) {
                        break;
                    }

                    shipsArray[key] = null;

                    // ship is too long
                    if (++k > 4) {
                        customLog('ship is too long');
                        return false;
                    }
                }

                // if not last direction check and only one (otherwise in both direction at least 1 mast would be found)
                if ((k === 1) && ((j + 1) !== directionMultipliers.length)) {
                    continue;
                }

                break; // either k > 1 (so ship found) or last loop
            }

            shipsTypes[k]++;
        }

        // strange way to check if ships_types === {1:4, 2:3, 3:2, 4:1}
        for (i in shipsTypes) {
            if (parseInt(i) + shipsTypes[i] !== 5) {
                customLog('incorrect number of ships of this type');
                customLog(shipsTypes);
                return false;
            }
        }

        return true;
    }

    function randomShot() {
        var index,
            $emptyFields = $battleground.board(1).not('.miss, .hit');

        // random from 0 to the amount of empty fields - 1 (because first's index is 0)
        index = Math.floor(Math.random() * $emptyFields.length);
        $emptyFields.eq(index).trigger('click');
    }

    function randomShips(event) {
        var orientations = [0, 1], // 0 - vertical, 1 - horizontal
            directionMultipliers = [1, 10],
            shipsTypes = {1:4, 2:3, 3:2, 4:1},
            $board = $battleground.board(0),
            numberOfShips,
            masts,
            orientation,
            $startFields,
            index,
            idx,
            j,
            k;

        if (gameStarted) {
            alert('You can\'t set ships - the game has already started');
            return false;
        }

        $board.filter('.ship').click();
        for (numberOfShips in shipsTypes) {
            masts = shipsTypes[numberOfShips];

            for (j = 0; j < numberOfShips; j++) {
                orientation = orientations[ Math.floor(Math.random() * orientations.length) ];
                markRestrictedStarts($board, masts, orientation);
                $startFields = $board.not('.restricted');

                index = Math.floor(Math.random() * $startFields.length);
                idx = $board.index( $startFields.eq(index) );
                for (k = 0; k < masts; k++) {
                    $board.eq(idx + k * directionMultipliers[orientation]).click();
                }
            }
        }

        if (checkShips($board) === false) {
            if (event.data && event.data.retry > 0) {
                $board.removeClass('ship');
                event.data.retry--;

                return randomShips(event);
            }

            return false;
        }

        $board.removeClass('restricted');

        return true;
    }

    function markRestrictedStarts($board, masts, orientation) {
        var directionMultipliers = [1, 10],
            marks,
            i;

        marks = $board.filter('.ship').map(function() {
            var index = $board.index(this),
                idx = indexToArray(index),
                borderDistance = parseInt(idx[Number(!orientation)]),
                mark = [index],
                safeIndex,
                safeIdx,
                k;

            if (idx[0] < 9) {
                mark.push(index + 10);
                if (idx[1] < 9) {
                    mark.push(index + 11);
                }
                if (idx[1] > 0) {
                    mark.push(index + 9);
                }
            }

            if (idx[0] > 0) {
                mark.push(index - 10);
                if (idx[1] < 9) {
                    mark.push(index - 9);
                }
                if (idx[1] > 0) {
                    mark.push(index - 11);
                }
            }

            if (idx[1] < 9) {
                mark.push(index + 1);
            }

            if (idx[1] > 0) {
                mark.push(index - 1);
            }

            for (k = 2; (borderDistance - k >= 0) && (k <= masts); k++) {
                safeIndex = index - (k * directionMultipliers[orientation]);
                safeIdx = indexToArray(safeIndex);
                mark.push(safeIndex);

                if (safeIdx[orientation] > 0) {
                    mark.push(safeIndex - directionMultipliers[Number(!orientation)]);
                }
                if (safeIdx[orientation] < 9) {
                    mark.push(safeIndex + directionMultipliers[Number(!orientation)]);
                }
            }

            return mark;
        }).toArray();

        $board.removeClass('restricted');

        for (i = 0; i < marks.length; i++) {
            $board.eq(marks[i]).addClass('restricted');
        }

        if (orientation === 0) {
            $board.filter('div:nth-child(n+' + (13 - masts) + ')').addClass('restricted');
        } else {
            $board.slice((11 - masts) * 10).addClass('restricted');
        }
    }

    /**
     * Convert: 1 -> [0,1], 12 -> [1,2], 167 -> [6,7]
     * @param {Number} index
     * @return Array
     */
    function indexToArray(index) {
        if (index >= 100) {
            index = index - 100;
        }

        return ((index < 10 ? '0' : '') + index).split('');
    }

    /**
     * @param {Object} $field
     * @returns {Array}
     */
    function getPosition($field) {
        var index = $battleground.index($field),
            indexes = indexToArray(index);

        return [parseInt(indexes[1]), parseInt(indexes[0])];
    }

    function customLog(log) {
        if (debug !== true) {
            return;
        }

        console.log(log);
    }

    /**
     * @param {Array} position
     * @param {Number} boardNumber
     * @constructor
     */
    var PositionClass = function(position, boardNumber) {

        this.getField = function() {
            // parseInt('08') -> 0
            var index = parseInt([position[1], position[0]].join(''), 10);

            return $battleground.board(boardNumber).eq(index);
        };

        this.getPositionY = function() {
            return position[0];
        };

        this.getPositionX = function() {
            return position[1];
        };

        this.getLeftPosition = function() {
            return position[1] > 0 ? new PositionClass([position[0], position[1] - 1], boardNumber) : null;
        };

        this.getRighthPosition = function() {
            return position[1] < 9 ? new PositionClass([position[0], position[1] + 1], boardNumber) : null;
        };

        this.getTopPosition = function() {
            return position[0] > 0 ? new PositionClass([position[0] - 1, position[1]], boardNumber) : null;
        };

        this.getBottomPosition = function() {
            return position[0] < 9 ? new PositionClass([position[0] + 1, position[1]], boardNumber) : null;
        };

        this.getLeftTopPosition = function() {
            return (position[0] > 0 && position[1] > 0) ? new PositionClass([position[0] - 1, position[1] - 1], boardNumber) : null;
        };

        this.getRightTopPosition = function() {
            return (position[0] > 0 && position[1] < 9) ? new PositionClass([position[0] - 1, position[1] + 1], boardNumber) : null;
        };

        this.getLeftBottomPosition = function() {
            return (position[0] < 9 && position[1] > 0) ? new PositionClass([position[0] + 1, position[1] - 1], boardNumber) : null;
        };

        this.getRightBottomPosition = function() {
            return (position[0] < 9 && position[1] < 9) ? new PositionClass([position[0] + 1, position[1] + 1], boardNumber) : null;
        };

        this.getSurroundingPositions = function() {
            return [
                this.getLeftPosition(),
                this.getRighthPosition(),
                this.getTopPosition(),
                this.getBottomPosition(),
                this.getLeftTopPosition(),
                this.getRightTopPosition(),
                this.getLeftBottomPosition(),
                this.getRightBottomPosition()
            ];
        };

        this.getSidePositions = function() {
            return [
                this.getLeftPosition(),
                this.getRighthPosition(),
                this.getTopPosition(),
                this.getBottomPosition()
            ];
        };

        this.getCornerPositions = function() {
            return [
                this.getLeftTopPosition(),
                this.getRightTopPosition(),
                this.getLeftBottomPosition(),
                this.getRightBottomPosition()
            ];
        };
    };
};

$(function() {
    var Battleships = new BattleshipsClass();
    Battleships.run();
});
