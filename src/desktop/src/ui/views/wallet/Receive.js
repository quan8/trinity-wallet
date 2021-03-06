import React from 'react';
import PropTypes from 'prop-types';
import classNames from 'classnames';
import { withI18n } from 'react-i18next';
import { connect } from 'react-redux';

import {
    selectLatestAddressFromAccountFactory,
    selectAccountInfo,
    getSelectedAccountName,
    getSelectedAccountMeta,
} from 'selectors/accounts';

import { generateAlert } from 'actions/alerts';
import { generateNewAddress, addressValidationRequest, addressValidationSuccess } from 'actions/wallet';

import SeedStore from 'libs/SeedStore';
import { randomBytes } from 'libs/crypto';
import { byteToChar } from 'libs/helpers';
import Errors from 'libs/errors';
import { ADDRESS_LENGTH } from 'libs/iota/utils';

import Button from 'ui/components/Button';
import Icon from 'ui/components/Icon';
import Clipboard from 'ui/components/Clipboard';
import Text from 'ui/components/input/Text.js';
import QR from 'ui/components/QR';

import css from './receive.scss';

/**
 * Send transactions component
 */
class Receive extends React.PureComponent {
    static propTypes = {
        /** @ignore */
        account: PropTypes.object.isRequired,
        /** @ignore */
        accountName: PropTypes.string.isRequired,
        /** @ignore */
        accountMeta: PropTypes.object.isRequired,
        /** @ignore */
        receiveAddress: PropTypes.string.isRequired,
        /** @ignore */
        password: PropTypes.object,
        /** @ignore */
        isSyncing: PropTypes.bool.isRequired,
        /** @ignore */
        isTransitioning: PropTypes.bool.isRequired,
        /** @ignore */
        generateNewAddress: PropTypes.func.isRequired,
        /** @ignore */
        isGeneratingReceiveAddress: PropTypes.bool.isRequired,
        /** @ignore */
        generateAlert: PropTypes.func.isRequired,
        /** @ignore */
        history: PropTypes.shape({
            push: PropTypes.func.isRequired,
        }).isRequired,
        /** @ignore */
        t: PropTypes.func.isRequired,
        /** @ignore */
        addressValidationRequest: PropTypes.func.isRequired,
        /** @ignore */
        addressValidationSuccess: PropTypes.func.isRequired,
        /** @ignore */
        isValidatingAddress: PropTypes.bool.isRequired,
    };

    state = {
        message: '',
        scramble: new Array(ADDRESS_LENGTH).fill(0),
    };

    componentDidMount() {
        if (!this.props.isGeneratingReceiveAddress && !this.props.isValidatingAddress) {
            this.validateAdress();
        }
    }

    componentWillReceiveProps(nextProps) {
        if (this.props.isGeneratingReceiveAddress && !nextProps.isGeneratingReceiveAddress) {
            this.frame = 0;

            this.setState({
                scramble: randomBytes(ADDRESS_LENGTH),
            });

            this.unscramble();

            if (!this.props.isValidatingAddress) {
                this.validateAdress();
            }
        }
    }

    componentWillUnmount() {
        this.frame = -1;
    }

    onGeneratePress = async () => {
        const {
            password,
            accountName,
            accountMeta,
            account,
            isSyncing,
            isTransitioning,
            generateAlert,
            t,
        } = this.props;

        if (isSyncing || isTransitioning) {
            return generateAlert('error', t('global:pleaseWait'), t('global:pleaseWaitExplanation'));
        }

        const seedStore = await new SeedStore[accountMeta.type](password, accountName, accountMeta);

        this.props.generateNewAddress(seedStore, accountName, account);
    };

    validateAdress = async () => {
        const { password, accountName, accountMeta, account, history, generateAlert, t } = this.props;
        const seedStore = await new SeedStore[accountMeta.type](password, accountName, accountMeta);

        try {
            if (accountMeta.type === 'ledger') {
                generateAlert('info', t('ledger:checkAddress'), t('ledger:checkAddressExplanation'), 20000);
            }
            this.props.addressValidationRequest();
            await seedStore.validateAddress(Object.keys(account.addresses).length - 1);
            this.props.addressValidationSuccess();
        } catch (err) {
            this.props.addressValidationSuccess();
            history.push('/wallet/');
            if (err.message === Errors.LEDGER_INVALID_INDEX) {
                generateAlert(
                    'error',
                    t('ledger:ledgerIncorrectIndex'),
                    t('ledger:ledgerIncorrectIndexExplanation'),
                    20000,
                );
            }
        }
    };

    unscramble() {
        const { scramble } = this.state;

        if (this.frame < 0) {
            return;
        }

        const scrambleNew = [];
        let sum = -1;

        if (this.frame > 3) {
            sum = 0;

            for (let i = 0; i < scramble.length; i++) {
                sum += scramble[i];
                scrambleNew.push(Math.max(0, scramble[i] - 15));
            }

            this.setState({
                scramble: scrambleNew,
            });

            this.frame = 0;
        }

        this.frame++;

        if (sum !== 0) {
            requestAnimationFrame(this.unscramble.bind(this));
        }
    }

    render() {
        const { t, receiveAddress, isGeneratingReceiveAddress } = this.props;
        const { message, scramble } = this.state;

        return (
            <div className={classNames(css.receive, receiveAddress.length < 2 ? css.empty : css.full)}>
                <div className={isGeneratingReceiveAddress ? css.loading : null}>
                    <QR data={JSON.stringify({ address: receiveAddress, message: message })} />
                    <Clipboard
                        text={receiveAddress}
                        title={t('receive:addressCopied')}
                        success={t('receive:addressCopiedExplanation')}
                    >
                        <p>
                            {receiveAddress.split('').map((char, index) => {
                                const scrambleChar = scramble[index] > 0 ? byteToChar(scramble[index]) : null;
                                return <React.Fragment key={`char-${index}`}>{scrambleChar || char}</React.Fragment>;
                            })}
                        </p>
                    </Clipboard>
                </div>
                <div>
                    <Button className="icon" loading={isGeneratingReceiveAddress} onClick={this.onGeneratePress}>
                        <Icon icon="sync" size={32} />
                        {t('receive:generateNewAddress')}
                    </Button>
                </div>
                <div>
                    <Text
                        value={message}
                        label={t('send:message')}
                        onChange={(value) => this.setState({ message: value })}
                    />
                    <footer>
                        <Button to="/wallet/" variant="secondary" className="outlineSmall">
                            {t('close')}
                        </Button>
                        <Clipboard
                            text={receiveAddress}
                            title={t('receive:addressCopied')}
                            success={t('receive:addressCopiedExplanation')}
                        >
                            <Button className="small" onClick={() => {}}>
                                {t('receive:copyAddress')}
                            </Button>
                        </Clipboard>
                    </footer>
                </div>
            </div>
        );
    }
}

const mapStateToProps = (state) => ({
    receiveAddress: selectLatestAddressFromAccountFactory(state),
    isGeneratingReceiveAddress: state.ui.isGeneratingReceiveAddress,
    isSyncing: state.ui.isSyncing,
    isTransitioning: state.ui.isTransitioning,
    account: selectAccountInfo(state),
    accountName: getSelectedAccountName(state),
    accountMeta: getSelectedAccountMeta(state),
    password: state.wallet.password,
    isValidatingAddress: state.wallet.isValidatingAddress,
});

const mapDispatchToProps = {
    generateAlert,
    generateNewAddress,
    addressValidationRequest,
    addressValidationSuccess,
};

export default connect(mapStateToProps, mapDispatchToProps)(withI18n()(Receive));
